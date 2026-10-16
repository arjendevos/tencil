import { realpath } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';
import type {
    CreatedThread,
    CreateThreadInput,
    ImageAttachment,
    Provider,
    ProviderInfo,
    ProviderProject,
    ProviderThreadSummary,
    SendMessageInput,
    ThreadSink,
    ThreadStatus,
} from '@tencildev/protocol';
import {
    type EnsembleAttachment,
    EnsembleClient,
    type EnsembleEvent,
    EnsembleHttpError,
    type EnsembleProject,
    type EnsembleThread,
} from './api.ts';
import { defaultEnsembleDir, ensembleUrl, threadForPath } from './locate.ts';
import { ThreadState, type Update } from './transcript.ts';

export interface EnsembleProviderOptions {
    /** Directory the dev site lives in. */
    projectRoot: string;
    /** The Ensemble host; read from its `listen-port` file when absent. */
    baseUrl?: string;
    /** Ensemble's local host folder; see `defaultEnsembleDir`. */
    ensembleDir?: string;
    timeouts?: {
        requestMs?: number;
        /** How long one events poll waits for news. */
        pollSeconds?: number;
        reconnectMinMs?: number;
        reconnectMaxMs?: number;
    };
    log?: (message: string) => void;
}

/**
 * Where pins go: a page served from an Ensemble thread's workspace continues
 * that thread (its dev server runs the thread's code); any other page starts
 * threads in the Ensemble project holding it.
 */
type Target =
    | { kind: 'thread'; threadId: string; project: EnsembleProject }
    | { kind: 'project'; project: EnsembleProject };

interface Watcher {
    threadId: string;
    sink: ThreadSink;
    state: ThreadState;
    /** Live events that arrived while the transcript was loading. */
    pending?: EnsembleEvent[];
}

/** Most transcript pages a replay reads; older history isn't shown. */
const MAX_REPLAY_PAGES = 40;

/**
 * Sends pins to Ensemble (tryensemble.co) through the HTTP API of the host it
 * runs on this machine. Ensemble keeps the conversations; the provider replays
 * a thread's transcript, then follows the host's event log.
 */
export class EnsembleProvider implements Provider {
    readonly id = 'ensemble';
    readonly label = 'Ensemble';

    readonly #options: EnsembleProviderOptions;
    readonly #dir: string;
    #info: ProviderInfo = { id: 'ensemble', label: 'Ensemble', state: 'connecting' };
    #infoListeners = new Set<(info: ProviderInfo) => void>();
    #client: EnsembleClient | undefined;
    #target: Target | undefined;
    #connecting: Promise<void> | undefined;
    #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    #reconnectDelay: number;
    readonly #watchers = new Map<string, Set<Watcher>>();
    /** Last event seen in the host's log; polling starts once a replay sets it. */
    #cursor: number | undefined;
    #polling: AbortController | undefined;
    #disposed = false;

    constructor(options: EnsembleProviderOptions) {
        this.#options = options;
        this.#dir = options.ensembleDir ?? defaultEnsembleDir();
        this.#reconnectDelay = options.timeouts?.reconnectMinMs ?? 1000;
    }

    async start(): Promise<void> {
        await this.#connect();
    }

    info(): ProviderInfo {
        return this.#info;
    }

    onInfoChange(listener: (info: ProviderInfo) => void): () => void {
        this.#infoListeners.add(listener);
        return () => this.#infoListeners.delete(listener);
    }

    async listThreads(): Promise<{ project: ProviderProject; threads: ProviderThreadSummary[] }> {
        const { client, target } = await this.#require();
        const threads = (await client.threads())
            .filter(
                thread =>
                    thread.projectId === target.project.id &&
                    !thread.archivedAt &&
                    thread.state !== 'archived',
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(
                (thread): ProviderThreadSummary => ({
                    id: thread.id,
                    title: thread.title,
                    status: threadStatus(thread),
                    updatedAt: thread.createdAt,
                    ...(thread.branch ? { branch: thread.branch } : {}),
                    agent: thread.agent === 'codex' ? 'codex' : 'claudeAgent',
                }),
            );
        return { project: { name: target.project.name }, threads };
    }

    /** Ensemble has no links into its app. */
    threadUrl(): string | undefined {
        return undefined;
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const { client, target } = await this.#require();
        if (target.kind === 'thread') {
            await this.sendMessage({
                providerThreadId: target.threadId,
                text: input.text,
                attachments: input.attachments,
            });
            return { providerThreadId: target.threadId };
        }
        const thread = await client.createThread({
            projectId: target.project.id,
            prompt: input.text,
            title: input.title,
            attachments: input.attachments.map(attachment),
        });
        this.#log(`Started Ensemble thread ${thread.id}`);
        return { providerThreadId: thread.id };
    }

    async sendMessage(input: SendMessageInput): Promise<void> {
        const { client } = await this.#require();
        const question = this.#question(input.providerThreadId);
        await client.sendMessage(input.providerThreadId, {
            text: input.text,
            attachments: input.attachments.map(attachment),
            ...(question ? { answers: question } : {}),
        });
    }

    async interrupt(providerThreadId: string): Promise<void> {
        const { client } = await this.#require();
        await client.stop(providerThreadId);
    }

    watch(providerThreadId: string, sink: ThreadSink): () => void {
        const watcher: Watcher = {
            threadId: providerThreadId,
            sink,
            state: new ThreadState(),
            pending: [],
        };
        let set = this.#watchers.get(providerThreadId);
        if (!set) {
            set = new Set();
            this.#watchers.set(providerThreadId, set);
        }
        set.add(watcher);
        void this.#replay(watcher);
        return () => {
            set.delete(watcher);
            if (set.size === 0) this.#watchers.delete(providerThreadId);
            if (this.#watchers.size === 0) this.#stopPolling();
        };
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        clearTimeout(this.#reconnectTimer);
        this.#stopPolling();
        this.#watchers.clear();
    }

    /* -------------------------------- connection ------------------------------- */

    #connect(): Promise<void> {
        this.#connecting ??= (async () => {
            try {
                const baseUrl = this.#options.baseUrl ?? (await ensembleUrl(this.#dir));
                if (!baseUrl) {
                    throw new Unavailable(
                        "Ensemble isn't set up on this machine. Install it from tryensemble.co and open it once.",
                    );
                }
                const client = new EnsembleClient({
                    baseUrl,
                    requestTimeoutMs: this.#options.timeouts?.requestMs,
                });
                await client.health().catch(() => {
                    throw new Unavailable("Ensemble isn't running. Open the Ensemble app.");
                });
                this.#client = client;
                const target = await this.#resolveTarget(client);
                this.#target = target;
                this.#reconnectDelay = this.#options.timeouts?.reconnectMinMs ?? 1000;
                this.#setInfo({ state: 'ready', target: await this.#targetLabel(client, target) });
                this.#log(`Ensemble ready at ${baseUrl}`);
                // Watches made while disconnected load now.
                for (const set of this.#watchers.values()) {
                    for (const watcher of set) if (watcher.pending) void this.#replay(watcher);
                }
                this.#poll();
            } catch (error) {
                this.#setInfo({ state: 'unavailable', detail: errorMessage(error) });
                this.#scheduleReconnect();
            } finally {
                this.#connecting = undefined;
            }
        })();
        return this.#connecting;
    }

    #scheduleReconnect(): void {
        if (this.#disposed || this.#reconnectTimer) return;
        const delay = this.#reconnectDelay;
        this.#reconnectDelay = Math.min(
            delay * 2,
            this.#options.timeouts?.reconnectMaxMs ?? 30_000,
        );
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = undefined;
            void this.#connect();
        }, delay);
        this.#reconnectTimer.unref?.();
    }

    /** The host went away (Ensemble quit, or restarted on another port). */
    #lost(error: unknown): void {
        if (this.#disposed) return;
        this.#stopPolling();
        this.#client = undefined;
        this.#setInfo({ state: 'unavailable', detail: `Lost Ensemble: ${errorMessage(error)}` });
        this.#scheduleReconnect();
    }

    async #require(): Promise<{ client: EnsembleClient; target: Target }> {
        if (!this.#client || !this.#target) await this.#connect();
        if (!this.#client || !this.#target) {
            throw new Error(this.#info.detail ?? "Ensemble isn't available");
        }
        return { client: this.#client, target: this.#target };
    }

    async #resolveTarget(client: EnsembleClient): Promise<Target> {
        const root = await realpath(this.#options.projectRoot).catch(
            () => this.#options.projectRoot,
        );
        const projects = await client.projects();
        const threadId =
            threadForPath(root, this.#dir) ?? threadForPath(root, await this.#realDir());
        if (threadId) {
            const thread = await client.thread(threadId).catch(() => undefined);
            const project = thread && projects.find(p => p.id === thread.projectId);
            if (thread && project) return { kind: 'thread', threadId, project };
        }
        let best: { project: EnsembleProject; depth: number } | undefined;
        for (const project of projects) {
            const folder = await realpath(project.remote).catch(() => project.remote);
            if (!contains(folder, root)) continue;
            const depth = folder.split(sep).length;
            if (!best || depth > best.depth) best = { project, depth };
        }
        if (best) return { kind: 'project', project: best.project };
        throw new Unavailable(
            `${basename(root)} isn't an Ensemble project. Add its folder in Ensemble, then reload.`,
        );
    }

    async #targetLabel(client: EnsembleClient, target: Target): Promise<string> {
        if (target.kind === 'project') return target.project.name;
        const thread = await client.thread(target.threadId).catch(() => undefined);
        return thread ? `${target.project.name} · ${thread.title}` : target.project.name;
    }

    #realDir(): Promise<string> {
        return realpath(this.#dir).catch(() => this.#dir);
    }

    /* --------------------------------- watching -------------------------------- */

    /** Load the thread's history into the watcher, then hand it the live events that came meanwhile. */
    async #replay(watcher: Watcher): Promise<void> {
        const client = this.#client;
        if (!client || !this.#isWatching(watcher)) return;
        try {
            const events: EnsembleEvent[] = [];
            let before: number | undefined;
            for (let page = 0; page < MAX_REPLAY_PAGES; page++) {
                const result = await client.transcript(watcher.threadId, before);
                events.push(...result.events);
                const oldest = result.events[0]?.seq;
                if (!result.more || oldest === undefined) break;
                before = oldest;
            }
            const thread = await client.thread(watcher.threadId);
            if (!this.#isWatching(watcher)) return;
            for (const event of events.sort((a, b) => a.seq - b.seq)) watcher.state.apply(event);
            const pending = watcher.pending ?? [];
            watcher.pending = undefined;
            if (thread.archivedAt || thread.state === 'archived') return watcher.sink.gone();
            this.#deliver(watcher, watcher.state.snapshot());
            for (const event of pending) this.#deliver(watcher, watcher.state.apply(event));
            if (this.#cursor === undefined) {
                this.#cursor = watcher.state.seq;
                this.#poll();
            }
        } catch (error) {
            if (error instanceof EnsembleHttpError && error.status === 404) {
                watcher.pending = undefined;
                watcher.sink.gone();
                return;
            }
            this.#log(`Couldn't load Ensemble thread ${watcher.threadId}: ${errorMessage(error)}`);
            // Try again once the connection is back.
            watcher.pending ??= [];
        }
    }

    #poll(): void {
        if (this.#polling || !this.#client || this.#cursor === undefined) return;
        if (this.#watchers.size === 0) return;
        const controller = new AbortController();
        this.#polling = controller;
        const client = this.#client;
        const wait = this.#options.timeouts?.pollSeconds ?? 25;
        void (async () => {
            while (!controller.signal.aborted && this.#cursor !== undefined) {
                let events: EnsembleEvent[];
                try {
                    events = await client.events(this.#cursor, wait, controller.signal);
                } catch (error) {
                    if (controller.signal.aborted) return;
                    if (this.#polling === controller) this.#polling = undefined;
                    return this.#lost(error);
                }
                for (const event of events) {
                    this.#cursor = Math.max(this.#cursor ?? 0, event.seq);
                    if (event.threadId) this.#dispatch(event);
                }
            }
        })();
    }

    #stopPolling(): void {
        this.#polling?.abort();
        this.#polling = undefined;
    }

    #dispatch(event: EnsembleEvent): void {
        const set = event.threadId ? this.#watchers.get(event.threadId) : undefined;
        if (!set) return;
        for (const watcher of set) {
            if (watcher.pending) watcher.pending.push(event);
            else this.#deliver(watcher, watcher.state.apply(event));
        }
    }

    #deliver(watcher: Watcher, update: Update): void {
        for (const message of update.messages) watcher.sink.message(message);
        for (const step of update.steps) watcher.sink.step?.(step);
        if (update.status) watcher.sink.status(update.status.status, update.status.detail);
        if (update.gone) watcher.sink.gone();
    }

    #isWatching(watcher: Watcher): boolean {
        return !this.#disposed && (this.#watchers.get(watcher.threadId)?.has(watcher) ?? false);
    }

    #question(threadId: string): string | undefined {
        for (const watcher of this.#watchers.get(threadId) ?? []) {
            if (watcher.state.question) return watcher.state.question;
        }
        return undefined;
    }

    /* --------------------------------- helpers --------------------------------- */

    #setInfo(next: Omit<ProviderInfo, 'id' | 'label'>): void {
        const info: ProviderInfo = { id: this.id, label: this.label, ...next };
        if (
            info.state === this.#info.state &&
            info.detail === this.#info.detail &&
            info.target === this.#info.target
        ) {
            return;
        }
        this.#info = info;
        for (const listener of this.#infoListeners) listener(info);
    }

    #log(message: string): void {
        this.#options.log?.(message);
    }
}

class Unavailable extends Error {}

function threadStatus(thread: EnsembleThread): Exclude<ThreadStatus, 'draft' | 'starting'> {
    if (thread.state === 'running' || thread.state === 'starting') return 'working';
    if (thread.state === 'failed') return 'error';
    return 'idle';
}

function attachment(image: ImageAttachment): EnsembleAttachment {
    return {
        name: image.name,
        mediaType: image.mimeType,
        data: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
    };
}

function contains(folder: string, path: string): boolean {
    const rel = relative(folder, path);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
