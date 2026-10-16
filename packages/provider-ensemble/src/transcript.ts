import type { ProviderMessage, ThreadStatus, ThreadStep } from '@tencildev/protocol';
import type { EnsembleEvent } from './api.ts';

export type RunStatus = {
    status: Exclude<ThreadStatus, 'starting' | 'draft'>;
    detail?: string;
};

export interface Update {
    messages: ProviderMessage[];
    steps: ThreadStep[];
    /** Set when the status changed. */
    status?: RunStatus;
    /** The thread was archived in Ensemble. */
    gone?: boolean;
}

const MAX_DETAIL = 200;

/**
 * Folds a thread's Ensemble events into what a pin shows: messages, the run
 * status and the current turn's tool calls. Agent output arrives as the
 * agent's own stream (Claude Code's stream-json, Codex's `item.*` events),
 * wrapped in `agent.event`. Side chats (`chatId`) are left out.
 */
export class ThreadState {
    readonly messages = new Map<string, ProviderMessage>();
    readonly steps = new Map<string, ThreadStep>();
    /** Highest event applied; replays and live polls skip anything at or below it. */
    seq = 0;
    #status: RunStatus = { status: 'idle' };
    /** The open question the agent asked, which the next message answers. */
    question: string | undefined;

    status(): RunStatus {
        return this.#status;
    }

    apply(event: EnsembleEvent): Update {
        const update: Update = { messages: [], steps: [] };
        if (event.seq <= this.seq) return update;
        this.seq = event.seq;
        if (event.chatId) return update;
        const payload = event.payload;
        const at = event.createdAt;

        switch (event.kind) {
            case 'message.user': {
                this.question = undefined;
                this.#message(update, {
                    id: `ensemble:${event.seq}`,
                    role: 'user',
                    text: str(payload.text),
                    streaming: false,
                    createdAt: at,
                });
                this.#setStatus(update, { status: 'working' });
                break;
            }
            case 'turn.started':
                this.steps.clear();
                this.#setStatus(update, { status: 'working' });
                break;
            case 'question.asked': {
                this.question = str(payload.id) || undefined;
                const questions = Array.isArray(payload.questions) ? payload.questions : [];
                const first = questions[0] as { question?: unknown } | undefined;
                this.#setStatus(update, {
                    status: 'waiting',
                    detail: str(first?.question) || 'The agent asked a question',
                });
                break;
            }
            case 'question.closed':
                if (this.question === str(payload.id)) this.question = undefined;
                break;
            case 'approval.asked':
                this.#setStatus(update, {
                    status: 'waiting',
                    detail: `Approve ${str(payload.tool) || 'a tool'} in Ensemble`,
                });
                break;
            case 'approval.answered':
                this.#setStatus(update, { status: 'working' });
                break;
            case 'turn.ended': {
                const outcome = str(payload.outcome);
                this.#finishSteps(update, at, outcome === 'stopped' ? 'skipped' : 'done');
                if (outcome === 'asked' && this.question) break;
                if (outcome === 'failed') {
                    this.#setStatus(update, {
                        status: 'error',
                        detail: str(payload.error) || 'The turn failed in Ensemble',
                    });
                } else {
                    this.#setStatus(update, { status: 'idle' });
                }
                break;
            }
            case 'turn.stopped':
                this.#finishSteps(update, at, 'skipped');
                this.#setStatus(update, { status: 'idle' });
                break;
            case 'thread.state': {
                const state = str(payload.state);
                if (state === 'archived') update.gone = true;
                else if (state === 'running' || state === 'starting') {
                    if (this.#status.status !== 'waiting') {
                        this.#setStatus(update, { status: 'working' });
                    }
                } else if (state === 'failed') {
                    this.#setStatus(update, {
                        status: 'error',
                        detail: str(payload.error) || 'The thread failed in Ensemble',
                    });
                } else if (state === 'idle' && !this.question) {
                    this.#setStatus(update, { status: 'idle' });
                }
                break;
            }
            case 'thread.archived':
                update.gone = true;
                break;
            case 'agent.event':
                this.#agentEvent(update, event);
                break;
        }
        return update;
    }

    /** Where a replay leaves things: the stored state, as one update. */
    snapshot(): Update {
        return {
            messages: [...this.messages.values()].sort((a, b) =>
                a.createdAt.localeCompare(b.createdAt),
            ),
            steps: [...this.steps.values()],
            status: this.#status,
        };
    }

    #agentEvent(update: Update, event: EnsembleEvent): void {
        const payload = event.payload;
        const type = str(payload.type);
        if (type.startsWith('item.') || type.startsWith('turn.') || type === 'error') {
            this.#codexEvent(update, event, type);
            return;
        }
        // Subagents' own messages stay inside their tool call.
        if (payload.parent_tool_use_id) return;
        const message = payload.message as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content) ? message.content : [];

        if (type === 'assistant') {
            if (typeof payload.error === 'string') {
                this.#setStatus(update, { status: 'error', detail: payload.error });
                return;
            }
            content.forEach((block: Record<string, unknown>, index: number) => {
                if (block.type === 'text' && str(block.text).trim()) {
                    this.#message(update, {
                        id: `ensemble:${event.seq}.${index}`,
                        role: 'assistant',
                        text: str(block.text),
                        streaming: false,
                        createdAt: event.createdAt,
                    });
                } else if (block.type === 'tool_use') {
                    const id = str(block.id) || `${event.seq}.${index}`;
                    this.#step(update, {
                        id,
                        label: str(block.name) || 'Tool',
                        status: 'running',
                        ...detail(block.input),
                        startedAt: event.createdAt,
                    });
                }
            });
        } else if (type === 'user') {
            for (const block of content as Array<Record<string, unknown>>) {
                if (block.type !== 'tool_result') continue;
                const step = this.steps.get(str(block.tool_use_id));
                if (!step) continue;
                this.#step(update, {
                    ...step,
                    status: block.is_error === true ? 'failed' : 'done',
                    endedAt: event.createdAt,
                });
            }
        }
    }

    #codexEvent(update: Update, event: EnsembleEvent, type: string): void {
        const payload = event.payload;
        if (type === 'turn.failed') {
            const error = payload.error as { message?: unknown } | undefined;
            this.#setStatus(update, {
                status: 'error',
                detail: str(error?.message) || 'Codex reported an error',
            });
            return;
        }
        if (type !== 'item.started' && type !== 'item.completed') return;
        const item = (payload.item ?? {}) as Record<string, unknown>;
        const done = type === 'item.completed';
        const id = `codex:${str(item.id)}`;
        if (item.type === 'agent_message') {
            if (done && str(item.text).trim()) {
                this.#message(update, {
                    id: `ensemble:${id}`,
                    role: 'assistant',
                    text: str(item.text),
                    streaming: false,
                    createdAt: event.createdAt,
                });
            }
            return;
        }
        const label =
            item.type === 'command_execution'
                ? 'Bash'
                : item.type === 'file_change'
                  ? 'Edit'
                  : item.type === 'web_search'
                    ? 'Search the web'
                    : item.type === 'mcp_tool_call'
                      ? `${str(item.server) || 'MCP'}: ${str(item.tool) || 'tool'}`
                      : undefined;
        if (!label) return;
        const failed =
            done &&
            ((item.type === 'command_execution' &&
                item.exit_code !== 0 &&
                item.exit_code != null) ||
                item.status === 'failed');
        const started = this.steps.get(id)?.startedAt ?? event.createdAt;
        this.#step(update, {
            id,
            label,
            status: done ? (failed ? 'failed' : 'done') : 'running',
            ...detail(
                item.type === 'file_change'
                    ? { path: changedPaths(item.changes) }
                    : item.type === 'web_search'
                      ? { query: item.query }
                      : item,
            ),
            startedAt: started,
            ...(done ? { endedAt: event.createdAt } : {}),
        });
    }

    #message(update: Update, message: ProviderMessage): void {
        this.messages.set(message.id, message);
        update.messages.push(message);
    }

    #step(update: Update, step: ThreadStep): void {
        this.steps.set(step.id, step);
        update.steps.push(step);
    }

    #finishSteps(update: Update, at: string, status: 'done' | 'skipped'): void {
        for (const step of this.steps.values()) {
            if (step.status === 'running') this.#step(update, { ...step, status, endedAt: at });
        }
    }

    #setStatus(update: Update, status: RunStatus): void {
        if (status.status === this.#status.status && status.detail === this.#status.detail) return;
        this.#status = status;
        update.status = status;
    }
}

/** The second line of a step: the command, file or query it ran on. */
function detail(input: unknown): { detail?: string } {
    if (!input || typeof input !== 'object') return {};
    const fields = input as Record<string, unknown>;
    for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
        const value = fields[key];
        if (typeof value === 'string' && value.trim()) {
            const line = value.trim().split('\n')[0] ?? '';
            return { detail: line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL)}…` : line };
        }
    }
    return {};
}

function changedPaths(changes: unknown): string {
    if (!Array.isArray(changes)) return '';
    return changes
        .map(change => str((change as { path?: unknown }).path))
        .filter(Boolean)
        .join(', ');
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
