/**
 * The Ensemble host's HTTP API, as its desktop app uses it: plain JSON on
 * loopback, no auth. Threads stream through one event log for the whole host
 * (`/v1/events?after=<seq>&wait=<s>` long-polls), and each thread's history
 * pages back through `/v1/threads/<id>/transcript?before=<seq>`.
 */

export interface EnsembleProject {
    id: string;
    name: string;
    /** The project's folder (or git URL) on this machine. */
    remote: string;
    createdAt: string;
}

export interface EnsembleThread {
    id: string;
    projectId: string;
    title: string;
    branch: string;
    /** `starting`, `running`, `idle`, `failed` or `archived`. */
    state: string;
    /** `claude` or `codex`. */
    agent: string;
    createdAt: string;
    archivedAt: string | null;
}

export interface EnsembleEvent {
    seq: number;
    threadId: string | null;
    /** Side chats of a thread; the main conversation has none. */
    chatId: string | null;
    kind: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

export interface EnsembleAttachment {
    name: string;
    mediaType: string;
    /** Base64, without a data URL prefix. */
    data: string;
}

export class EnsembleHttpError extends Error {
    readonly status: number;

    constructor(status: number, reason: string) {
        super(`Ensemble returned ${status}: ${reason}`);
        this.status = status;
    }
}

export interface EnsembleClientOptions {
    baseUrl: string;
    requestTimeoutMs?: number;
}

export class EnsembleClient {
    readonly baseUrl: string;
    readonly #timeoutMs: number;

    constructor(options: EnsembleClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.#timeoutMs = options.requestTimeoutMs ?? 10_000;
    }

    health(): Promise<{ status: string; agents?: Record<string, string> }> {
        return this.#send('GET', 'health');
    }

    projects(): Promise<EnsembleProject[]> {
        return this.#send('GET', 'projects');
    }

    threads(): Promise<EnsembleThread[]> {
        return this.#send('GET', 'threads');
    }

    thread(id: string): Promise<EnsembleThread> {
        return this.#send('GET', `threads/${encodeURIComponent(id)}`);
    }

    transcript(id: string, before?: number): Promise<{ events: EnsembleEvent[]; more: boolean }> {
        const query = before === undefined ? '' : `?before=${before}`;
        return this.#send('GET', `threads/${encodeURIComponent(id)}/transcript${query}`);
    }

    createThread(input: {
        projectId: string;
        prompt: string;
        title?: string;
        attachments: EnsembleAttachment[];
    }): Promise<EnsembleThread> {
        return this.#send('POST', 'threads', input);
    }

    /** `answers` names the open question the message replies to. */
    sendMessage(
        id: string,
        input: { text: string; attachments: EnsembleAttachment[]; answers?: string },
    ): Promise<unknown> {
        return this.#send('POST', `threads/${encodeURIComponent(id)}/messages`, {
            chatId: '',
            ...input,
        });
    }

    stop(id: string): Promise<unknown> {
        return this.#send('POST', `threads/${encodeURIComponent(id)}/stop`, { chatId: '' });
    }

    /** Events after `after`, waiting up to `waitSeconds` for one when there are none yet. */
    events(after: number, waitSeconds: number, signal?: AbortSignal): Promise<EnsembleEvent[]> {
        return this.#send('GET', `events?after=${after}&wait=${waitSeconds}`, undefined, {
            signal,
            timeoutMs: this.#timeoutMs + waitSeconds * 1000,
        });
    }

    async #send<T>(
        method: string,
        path: string,
        body?: unknown,
        options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<T> {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs);
        const response = await fetch(`${this.baseUrl}/v1/${path}`, {
            method,
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        });
        const text = await response.text();
        if (!response.ok) {
            let reason = text || response.statusText;
            try {
                reason = (JSON.parse(text) as { error?: string }).error ?? reason;
            } catch {}
            throw new EnsembleHttpError(response.status, reason);
        }
        return (text ? JSON.parse(text) : undefined) as T;
    }
}
