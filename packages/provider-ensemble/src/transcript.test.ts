import { describe, expect, it } from 'vitest';
import type { EnsembleEvent } from './api.ts';
import { ThreadState } from './transcript.ts';

let seq = 0;
const event = (kind: string, payload: Record<string, unknown>, chatId: string | null = null) =>
    ({
        seq: ++seq,
        threadId: 't',
        chatId,
        kind,
        payload,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    }) satisfies EnsembleEvent;

describe('ThreadState', () => {
    it("reads Codex's items: replies and commands", () => {
        const state = new ThreadState();
        state.apply(event('turn.started', {}));
        state.apply(
            event('agent.event', {
                type: 'item.started',
                item: { id: 'i1', type: 'command_execution', command: 'ls' },
            }),
        );
        state.apply(
            event('agent.event', {
                type: 'item.completed',
                item: { id: 'i1', type: 'command_execution', command: 'ls', exit_code: 1 },
            }),
        );
        const update = state.apply(
            event('agent.event', {
                type: 'item.completed',
                item: { id: 'i2', type: 'agent_message', text: 'Done' },
            }),
        );
        expect(update.messages).toEqual([
            expect.objectContaining({ role: 'assistant', text: 'Done' }),
        ]);
        expect(state.steps.get('codex:i1')).toMatchObject({
            label: 'Bash',
            detail: 'ls',
            status: 'failed',
        });
    });

    it('turns a failed turn into an error with its reason', () => {
        const state = new ThreadState();
        state.apply(event('turn.started', {}));
        const update = state.apply(
            event('turn.ended', { outcome: 'failed', error: 'Out of quota' }),
        );
        expect(update.status).toEqual({ status: 'error', detail: 'Out of quota' });
    });

    it('marks running steps skipped when the turn is stopped', () => {
        const state = new ThreadState();
        state.apply(event('turn.started', {}));
        state.apply(
            event('agent.event', {
                type: 'assistant',
                message: {
                    content: [
                        { type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/a.ts' } },
                    ],
                },
            }),
        );
        const update = state.apply(event('turn.ended', { outcome: 'stopped' }));
        expect(update.steps).toEqual([expect.objectContaining({ id: 'x', status: 'skipped' })]);
        expect(update.status).toEqual({ status: 'idle' });
    });

    it('skips subagent output, old events and archived threads', () => {
        const state = new ThreadState();
        const old = event('message.user', { text: 'hi' });
        state.apply(old);
        expect(state.apply(old).messages).toEqual([]);
        expect(
            state.apply(
                event('agent.event', {
                    type: 'assistant',
                    parent_tool_use_id: 'tool-1',
                    message: { content: [{ type: 'text', text: 'inside a subagent' }] },
                }),
            ).messages,
        ).toEqual([]);
        expect(state.apply(event('thread.state', { state: 'archived' })).gone).toBe(true);
    });
});
