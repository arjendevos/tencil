import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/**
 * A small stand-in for the Ensemble host's HTTP API: projects, threads, the
 * long-polled event log and per-thread transcripts. A user message runs a
 * turn that answers in Claude Code's stream-json, as Ensemble relays it.
 */
export interface FakeEnsembleOptions {
    projects?: FakeEnsembleProject[];
    /** Assistant reply for a user message. */
    reply?: (text: string) => string;
    /** Delay before a turn's reply and end. */
    turnDelayMs?: number;
    /** Events per transcript page, to exercise paging. */
    transcriptPageSize?: number;
    port?: number;
}

export interface FakeEnsembleProject {
    id: string;
    name: string;
    remote: string;
}

export interface FakeEnsembleThread {
    id: string;
    projectId: string;
    title: string;
    branch: string;
    state: string;
    agent: string;
    createdAt: string;
    archivedAt: string | null;
}

export interface FakeEnsembleEvent {
    seq: number;
    threadId: string | null;
    chatId: string | null;
    kind: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

interface RecordedCall {
    method: string;
    path: string;
    body: Record<string, unknown>;
}

export class FakeEnsembleServer {
    readonly calls: RecordedCall[] = [];
    readonly projects: FakeEnsembleProject[];
    readonly threads = new Map<string, FakeEnsembleThread>();
    readonly events: FakeEnsembleEvent[] = [];

    readonly #options: FakeEnsembleOptions;
    readonly #http: Server;
    readonly #sockets = new Set<Socket>();
    readonly #waiters = new Set<() => void>();
    #port = 0;

    private constructor(options: FakeEnsembleOptions) {
        this.#options = options;
        this.projects = options.projects ?? [];
        this.#http = createServer((request, response) => void this.#route(request, response));
        this.#http.on('connection', socket => {
            this.#sockets.add(socket);
            socket.on('close', () => this.#sockets.delete(socket));
        });
    }

    static async start(options: FakeEnsembleOptions = {}): Promise<FakeEnsembleServer> {
        const server = new FakeEnsembleServer(options);
        await new Promise<void>(resolve =>
            server.#http.listen(options.port ?? 0, '127.0.0.1', resolve),
        );
        const address = server.#http.address();
        server.#port = typeof address === 'object' && address ? address.port : 0;
        return server;
    }

    get url(): string {
        return `http://127.0.0.1:${this.#port}`;
    }

    get port(): number {
        return this.#port;
    }

    /** Seed an existing thread. */
    addThread(
        input: Partial<FakeEnsembleThread> & { projectId: string; title: string },
    ): FakeEnsembleThread {
        const thread: FakeEnsembleThread = {
            id: input.id ?? randomUUID(),
            branch: `ensemble/${randomUUID().slice(0, 8)}`,
            state: 'idle',
            agent: 'claude',
            createdAt: new Date().toISOString(),
            archivedAt: null,
            ...input,
        };
        this.threads.set(thread.id, thread);
        this.emit(thread.id, 'thread.created', { ...thread });
        return thread;
    }

    /** Append an event to the log, waking pollers. */
    emit(
        threadId: string | null,
        kind: string,
        payload: Record<string, unknown>,
        chatId: string | null = null,
    ): FakeEnsembleEvent {
        const event: FakeEnsembleEvent = {
            seq: this.events.length + 1,
            threadId,
            chatId,
            kind,
            payload,
            createdAt: new Date().toISOString(),
        };
        this.events.push(event);
        if (threadId && kind === 'thread.state') {
            const thread = this.threads.get(threadId);
            if (thread) thread.state = String(payload.state);
        }
        for (const wake of this.#waiters) wake();
        return event;
    }

    /** An agent text reply, as Claude Code's stream-json inside `agent.event`. */
    emitAssistant(threadId: string, text: string): FakeEnsembleEvent {
        return this.emit(threadId, 'agent.event', {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text }] },
            parent_tool_use_id: null,
        });
    }

    callsOf(method: string, path: string | RegExp): Record<string, unknown>[] {
        return this.calls
            .filter(
                call =>
                    call.method === method &&
                    (typeof path === 'string' ? call.path === path : path.test(call.path)),
            )
            .map(call => call.body);
    }

    async close(): Promise<void> {
        for (const wake of this.#waiters) wake();
        for (const socket of this.#sockets) socket.destroy();
        await new Promise<void>(resolve => this.#http.close(() => resolve()));
    }

    /* ---------------------------------- turns --------------------------------- */

    #runTurn(threadId: string, text: string, extra: Record<string, unknown> = {}): void {
        this.emit(threadId, 'turn.started', { turnId: randomUUID() });
        this.emit(threadId, 'message.user', { text, permissions: 'auto', ...extra });
        this.emit(threadId, 'thread.state', { state: 'running' });
        const reply = this.#options.reply?.(text) ?? `Done: ${text.split('\n')[0]}`;
        setTimeout(() => {
            const thread = this.threads.get(threadId);
            if (thread?.state !== 'running') return;
            this.emitAssistant(threadId, reply);
            this.emit(threadId, 'turn.ended', { outcome: 'done' });
            this.emit(threadId, 'thread.state', { state: 'idle' });
        }, this.#options.turnDelayMs ?? 10);
    }

    /* ---------------------------------- http ---------------------------------- */

    async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const method = request.method ?? 'GET';
        const path = url.pathname.replace(/^\/v1\//, '');
        const raw = await readBody(request);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        this.calls.push({ method, path, body });
        const json = (status: number, value: unknown) => {
            if (response.destroyed) return;
            response.writeHead(status, { 'content-type': 'application/json' });
            response.end(JSON.stringify(value));
        };
        const threadMatch = path.match(/^threads\/([^/]+)(?:\/(.+))?$/);

        if (method === 'GET' && path === 'health') return json(200, { status: 'ok' });
        if (method === 'GET' && path === 'projects') {
            return json(
                200,
                this.projects.map(p => ({ ...p, createdAt: '2026-01-01T00:00:00Z' })),
            );
        }
        if (method === 'GET' && path === 'threads') return json(200, [...this.threads.values()]);
        if (method === 'GET' && path === 'events') {
            const after = Number(url.searchParams.get('after') ?? 0);
            const wait = Number(url.searchParams.get('wait') ?? 0);
            const pending = () => this.events.filter(e => e.seq > after).slice(0, 500);
            if (pending().length === 0 && wait > 0) {
                await new Promise<void>(resolve => {
                    const wake = () => {
                        this.#waiters.delete(wake);
                        clearTimeout(timer);
                        resolve();
                    };
                    const timer = setTimeout(wake, wait * 1000);
                    this.#waiters.add(wake);
                    request.on('close', wake);
                });
            }
            return json(200, pending());
        }
        if (method === 'POST' && path === 'threads') {
            const projectId = String(body.projectId ?? '');
            const prompt = String(body.prompt ?? '');
            if (!projectId || !prompt) {
                return json(422, { error: 'projectId and a prompt or an attachment are required' });
            }
            if (!this.projects.some(p => p.id === projectId)) {
                return json(404, { error: 'not found' });
            }
            const thread = this.addThread({
                projectId,
                title: String(body.title ?? prompt.slice(0, 40)),
                state: 'starting',
            });
            this.#runTurn(thread.id, prompt);
            return json(201, thread);
        }
        if (threadMatch) {
            const [, id = '', rest] = threadMatch;
            const thread = this.threads.get(id);
            if (!thread) return json(404, { error: 'not found' });
            if (method === 'GET' && !rest) return json(200, thread);
            if (method === 'GET' && rest === 'transcript') {
                const before = Number(url.searchParams.get('before') ?? Number.POSITIVE_INFINITY);
                const size = this.#options.transcriptPageSize ?? 30;
                const own = this.events.filter(e => e.threadId === id && e.seq < before);
                const page = own.slice(-size);
                return json(200, { events: page, more: own.length > page.length });
            }
            if (method === 'POST' && rest === 'messages') {
                const text = String(body.text ?? '');
                if (!text) return json(422, { error: 'text or an attachment is required' });
                this.#runTurn(id, text, body.answers ? { answers: body.answers } : {});
                return json(200, {});
            }
            if (method === 'POST' && rest === 'stop') {
                this.emit(id, 'turn.ended', { outcome: 'stopped' });
                this.emit(id, 'thread.state', { state: 'idle' });
                return json(200, {});
            }
        }
        json(404, { error: 'not found' });
    }
}

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        request.setEncoding('utf8');
        request.on('data', chunk => {
            data += chunk;
        });
        request.on('end', () => resolve(data));
        request.on('error', reject);
    });
}
