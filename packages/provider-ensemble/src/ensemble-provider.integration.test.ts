import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderMessage, ThreadSink, ThreadStatus, ThreadStep } from '@tencildev/protocol';
import { FakeEnsembleServer, waitFor } from '@tencildev/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EnsembleProvider, type EnsembleProviderOptions } from './ensemble-provider.ts';

const FAST = { requestMs: 1_000, pollSeconds: 1, reconnectMinMs: 20, reconnectMaxMs: 100 };
const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});

function tempDir(prefix: string): string {
    return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

async function setup(
    options: Partial<EnsembleProviderOptions> & {
        seedProject?: boolean;
        pageSize?: number;
        subdir?: string;
    } = {},
) {
    const root = tempDir('tencil-project-');
    const projectRoot = join(root, options.subdir ?? '');
    mkdirSync(projectRoot, { recursive: true });
    const ensembleDir = tempDir('tencil-ensemble-');
    const server = await FakeEnsembleServer.start({
        projects: options.seedProject === false ? [] : [{ id: 'p1', name: 'acme', remote: root }],
        transcriptPageSize: options.pageSize,
    });
    writeFileSync(join(ensembleDir, 'listen-port'), `${server.port}\n`);
    const provider = new EnsembleProvider({
        projectRoot,
        ensembleDir,
        timeouts: FAST,
        ...options,
    });
    cleanup.push(async () => {
        await provider.dispose();
        await server.close();
    });
    return { root, ensembleDir, server, provider };
}

function recordingSink() {
    const messages = new Map<string, ProviderMessage>();
    const statuses: Array<{ status: ThreadStatus; detail?: string }> = [];
    const steps = new Map<string, ThreadStep>();
    let gone = false;
    const sink: ThreadSink = {
        message: message => messages.set(message.id, message),
        status: (status, detail) => statuses.push({ status, detail }),
        step: step => steps.set(step.id, step),
        gone: () => {
            gone = true;
        },
    };
    const last = () => statuses.at(-1)?.status;
    return { sink, messages, statuses, steps, last, isGone: () => gone };
}

const ready = (provider: EnsembleProvider) =>
    waitFor(() => provider.info().state === 'ready', { message: 'provider ready' });

describe('Ensemble provider', () => {
    it('finds the host through its port file and maps the folder to its project', async () => {
        const { provider } = await setup();
        await provider.start();
        expect(provider.info()).toMatchObject({ state: 'ready', target: 'acme' });
    });

    it('maps a subfolder of the project, like a monorepo app', async () => {
        const { provider } = await setup({ subdir: join('apps', 'web') });
        await provider.start();
        expect(provider.info()).toMatchObject({ state: 'ready', target: 'acme' });
    });

    it("is unavailable when the folder isn't an Ensemble project", async () => {
        const { provider } = await setup({ seedProject: false });
        await provider.start();
        expect(provider.info().state).toBe('unavailable');
        expect(provider.info().detail).toContain("isn't an Ensemble project");
    });

    it("is unavailable when Ensemble isn't installed", async () => {
        const provider = new EnsembleProvider({
            projectRoot: tempDir('tencil-project-'),
            ensembleDir: tempDir('tencil-ensemble-'),
            timeouts: FAST,
        });
        cleanup.push(() => provider.dispose());
        await provider.start();
        expect(provider.info()).toMatchObject({ state: 'unavailable' });
        expect(provider.info().detail).toContain('tryensemble.co');
    });

    it('starts a thread with the screenshot and follows the reply', async () => {
        const { provider, server } = await setup();
        await provider.start();

        const created = await provider.createThread({
            title: 'Make it blue',
            text: 'Make the button blue',
            attachments: [{ name: 'shot.png', mimeType: 'image/png', dataUrl: PNG }],
        });
        expect(server.callsOf('POST', 'threads')).toEqual([
            expect.objectContaining({
                projectId: 'p1',
                prompt: 'Make the button blue',
                title: 'Make it blue',
                attachments: [
                    { name: 'shot.png', mediaType: 'image/png', data: PNG.split(',')[1] },
                ],
            }),
        ]);

        const { sink, messages, last } = recordingSink();
        provider.watch(created.providerThreadId, sink);
        await waitFor(() => [...messages.values()].find(m => m.role === 'assistant'), {
            message: 'assistant reply',
        });
        await waitFor(() => last() === 'idle', { message: 'idle' });
        expect([...messages.values()].map(m => [m.role, m.text])).toEqual([
            ['user', 'Make the button blue'],
            ['assistant', 'Done: Make the button blue'],
        ]);
    });

    it('replays a long transcript across pages, then follows live events', async () => {
        const { provider, server } = await setup({ pageSize: 3 });
        const thread = server.addThread({ projectId: 'p1', title: 'Old' });
        for (let i = 0; i < 5; i++) {
            server.emit(thread.id, 'message.user', { text: `q${i}` });
            server.emitAssistant(thread.id, `a${i}`);
        }
        await provider.start();
        const { sink, messages } = recordingSink();
        provider.watch(thread.id, sink);
        await waitFor(() => messages.size === 10, { message: 'replayed history' });

        server.emitAssistant(thread.id, 'live');
        await waitFor(() => [...messages.values()].some(m => m.text === 'live'), {
            message: 'live message',
        });
        expect([...messages.values()].map(m => m.text).slice(0, 2)).toEqual(['q0', 'a0']);
    });

    it('waits on a question and answers it with the next message', async () => {
        const { provider, server } = await setup();
        const thread = server.addThread({ projectId: 'p1', title: 'Ask' });
        server.emit(thread.id, 'question.asked', {
            id: 'q-1',
            questions: [{ question: 'Blue or green?', options: [] }],
        });
        server.emit(thread.id, 'turn.ended', { outcome: 'asked' });
        server.emit(thread.id, 'thread.state', { state: 'idle' });
        await provider.start();

        const { sink, statuses } = recordingSink();
        provider.watch(thread.id, sink);
        await waitFor(() => statuses.at(-1)?.status === 'waiting', { message: 'waiting' });
        expect(statuses.at(-1)?.detail).toBe('Blue or green?');

        await provider.sendMessage({ providerThreadId: thread.id, text: 'Blue', attachments: [] });
        expect(server.callsOf('POST', `threads/${thread.id}/messages`)).toEqual([
            { chatId: '', text: 'Blue', attachments: [], answers: 'q-1' },
        ]);
    });

    it('reports tool calls as steps and ignores side chats', async () => {
        const { provider, server } = await setup();
        const thread = server.addThread({ projectId: 'p1', title: 'Tools' });
        await provider.start();
        const { sink, messages, steps } = recordingSink();
        provider.watch(thread.id, sink);
        await waitFor(() => provider.info().state === 'ready');
        await new Promise(resolve => setTimeout(resolve, 50));

        server.emit(thread.id, 'turn.started', {});
        server.emit(thread.id, 'agent.event', {
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
                content: [
                    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } },
                ],
            },
        });
        server.emit(thread.id, 'agent.event', {
            type: 'user',
            parent_tool_use_id: null,
            message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] },
        });
        server.emit(thread.id, 'message.user', { text: 'from a side chat' }, 'chat-2');
        await waitFor(() => steps.get('t1')?.status === 'done', { message: 'step done' });
        expect(steps.get('t1')).toMatchObject({ label: 'Bash', detail: 'pnpm test' });
        expect([...messages.values()].some(m => m.text === 'from a side chat')).toBe(false);
    });

    it('continues the thread whose workspace serves the page', async () => {
        const { server, ensembleDir } = await setup();
        const thread = server.addThread({ projectId: 'p1', title: 'Landing' });
        const workspace = join(ensembleDir, 'threads', thread.id, 'workspace', 'landing');
        mkdirSync(workspace, { recursive: true });
        const provider = new EnsembleProvider({
            projectRoot: workspace,
            ensembleDir,
            timeouts: FAST,
        });
        cleanup.push(() => provider.dispose());
        await provider.start();
        expect(provider.info()).toMatchObject({ state: 'ready', target: 'acme · Landing' });

        const created = await provider.createThread({
            title: 'Pin',
            text: 'Tighten the hero',
            attachments: [],
        });
        expect(created.providerThreadId).toBe(thread.id);
        expect(server.callsOf('POST', 'threads')).toEqual([]);
        expect(server.callsOf('POST', `threads/${thread.id}/messages`)).toHaveLength(1);
    });

    it('lists the project threads newest first, without archived ones', async () => {
        const { provider, server } = await setup();
        server.addThread({ projectId: 'p1', title: 'Older', createdAt: '2026-01-01T00:00:00Z' });
        server.addThread({
            projectId: 'p1',
            title: 'Newer',
            createdAt: '2026-02-01T00:00:00Z',
            state: 'running',
            agent: 'codex',
        });
        server.addThread({
            projectId: 'p1',
            title: 'Gone',
            archivedAt: '2026-03-01T00:00:00Z',
        });
        server.addThread({ projectId: 'other', title: 'Elsewhere' });
        await provider.start();
        const { project, threads } = await provider.listThreads();
        expect(project).toEqual({ name: 'acme' });
        expect(threads.map(t => [t.title, t.status, t.agent])).toEqual([
            ['Newer', 'working', 'codex'],
            ['Older', 'idle', 'claudeAgent'],
        ]);
    });

    it('stops a turn', async () => {
        const { provider, server } = await setup();
        const thread = server.addThread({ projectId: 'p1', title: 'Stop' });
        await provider.start();
        await provider.interrupt(thread.id);
        expect(server.callsOf('POST', `threads/${thread.id}/stop`)).toEqual([{ chatId: '' }]);
    });

    it('reports a thread Ensemble no longer has as gone', async () => {
        const { provider } = await setup();
        await provider.start();
        const { sink, isGone } = recordingSink();
        provider.watch('missing', sink);
        await waitFor(() => isGone(), { message: 'gone' });
    });

    it('reconnects when Ensemble comes back', async () => {
        const { provider, server, ensembleDir, root } = await setup();
        const thread = server.addThread({ projectId: 'p1', title: 'Live' });
        await provider.start();
        const { sink, messages } = recordingSink();
        provider.watch(thread.id, sink);
        await waitFor(() => messages.size === 0 && provider.info().state === 'ready');
        await new Promise(resolve => setTimeout(resolve, 50));
        await server.close();
        await waitFor(() => provider.info().state === 'unavailable', { message: 'lost' });

        const next = await FakeEnsembleServer.start({
            projects: [{ id: 'p1', name: 'acme', remote: root }],
        });
        cleanup.push(() => next.close());
        writeFileSync(join(ensembleDir, 'listen-port'), `${next.port}\n`);
        await ready(provider);
    });
});
