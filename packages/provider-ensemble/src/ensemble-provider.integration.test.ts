import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderMessage, ThreadSink, ThreadStatus, ThreadStep } from '@tencildev/protocol';
import { FakeEnsembleServer, waitFor } from '@tencildev/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EnsembleClient } from './api.ts';
import { EnsembleCredentialStore } from './auth.ts';
import { EnsembleProvider } from './ensemble-provider.ts';
import { ensembleProjectForPort, ensembleRoot, listEnsembleProjects } from './projects.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
});
async function setup(autoAllow = true, silenceMs = 45_000) {
    const dir = await mkdtemp(join(tmpdir(), 'tencil-ensemble-'));
    const credentials = new EnsembleCredentialStore(join(dir, 'credentials.json'));
    const server = await FakeEnsembleServer.start({ autoAllow, turnDelayMs: 100 });
    const thread = server.addThread({ projectId: 'p1', title: 'Landing' });
    const provider = new EnsembleProvider({
        projectRoot: ensembleRoot(thread.id),
        baseUrl: server.url,
        credentials,
        timeouts: {
            requestMs: 1000,
            retryMs: 100,
            reconnectMinMs: 20,
            reconnectMaxMs: 100,
            silenceMs,
        },
    });
    cleanup.push(async () => {
        await provider.dispose();
        await server.close();
        await rm(dir, { recursive: true, force: true });
    });
    await provider.start();
    return { provider, server, thread, credentials };
}
function record() {
    const messages = new Map<string, ProviderMessage>();
    const steps = new Map<string, ThreadStep>();
    const statuses: ThreadStatus[] = [];
    let gone = false;
    const sink: ThreadSink = {
        message: message => messages.set(message.id, message),
        step: step => steps.set(step.id, step),
        status: status => statuses.push(status),
        gone: () => {
            gone = true;
        },
    };
    return { sink, messages, steps, statuses, last: () => statuses.at(-1), gone: () => gone };
}
const pin = { title: 'Make it blue', text: 'Make the button blue', attachments: [] };

describe('Ensemble public API', () => {
    it('discovers without auth, waits for approval and stores a private token', async () => {
        const { provider, server, credentials } = await setup(false);
        expect(await new EnsembleClient({ baseUrl: server.url }).isRunning()).toBe(true);
        expect(provider.info()).toMatchObject({ state: 'unauthorized', canPair: true });
        const pairing = provider.pair();
        await waitFor(() => server.callsOf('POST', 'connect').length === 1);
        expect(provider.info().state).toBe('connecting');
        server.allow();
        await pairing;
        expect(provider.info()).toMatchObject({ state: 'ready', target: 'Landing' });
        expect(await credentials.get(server.url)).toMatch(/^ens_/);
        expect((await stat(credentials.path)).mode & 0o777).toBe(0o600);
        expect(server.callsOf('POST', 'connect')).toEqual([{ name: 'Tencil', access: 'work' }]);
    });
    it.each([403, 408])('allows pairing again after connect returns %s', async status => {
        const { provider, server } = await setup(false);
        const pairing = provider.pair();
        const rejection = expect(pairing).rejects.toThrow(String(status));
        await waitFor(() => server.callsOf('POST', 'connect').length === 1);
        server.deny(status);
        await rejection;
        expect(provider.info()).toMatchObject({ state: 'unauthorized', canPair: true });
        const retry = provider.pair();
        await waitFor(() => server.callsOf('POST', 'connect').length === 2);
        server.allow();
        await retry;
        expect(provider.info().state).toBe('ready');
    });
    it('creates one chat per pin on the same checkout, with attachments and deep links', async () => {
        const { provider, server, thread } = await setup();
        await provider.pair();
        const first = await provider.createThread({
            ...pin,
            attachments: [
                { name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,YWJj' },
            ],
        });
        const second = await provider.createThread(pin);
        expect(first.providerThreadId).toMatch(new RegExp(`^${thread.id}/`));
        expect(second.providerThreadId).not.toBe(first.providerThreadId);
        expect(first.url).toBe(`ensemble://thread/${thread.id}`);
        expect(server.callsOf('POST', `threads/${thread.id}/chats`)[0]).toMatchObject({
            prompt: pin.text,
            title: pin.title,
            attachments: [{ name: 'shot.png', mediaType: 'image/png', data: 'YWJj' }],
        });
        const listed = await provider.listThreads();
        expect(listed.project.name).toBe('Landing');
        expect(listed.threads.map(t => t.id)).toContain(first.providerThreadId);
        const writes = server.calls.filter(c => c.method === 'POST');
        expect(new Set(writes.map(c => c.headers['idempotency-key'])).size).toBe(writes.length);
        expect(writes.every(c => c.headers['idempotency-key'])).toBe(true);
    });
    it('streams cumulative replies, shares one feed, replays late watchers and routes steps and status', async () => {
        const { provider, server, thread } = await setup();
        await provider.pair();
        const first = await provider.createThread(pin);
        const second = await provider.createThread({ ...pin, text: 'Other pin' });
        const a = record();
        const b = record();
        provider.watch(first.providerThreadId, a.sink);
        provider.watch(second.providerThreadId, b.sink);
        const streaming = await waitFor(() => [...a.messages.values()].find(m => m.streaming));
        await waitFor(() => a.last() === 'idle' && b.last() === 'idle');
        expect(server.feedCount).toBe(1);
        expect(a.messages.get(streaming.id)).toMatchObject({
            text: `Done: ${pin.text}`,
            streaming: false,
            createdAt: streaming.createdAt,
        });
        expect([...b.messages.values()].some(m => m.text.includes(pin.text))).toBe(false);
        const late = record();
        provider.watch(first.providerThreadId, late.sink);
        expect([...late.messages.values()]).toEqual([...a.messages.values()]);
        const chatId = first.providerThreadId.split('/')[1];
        server.emit('steps', {
            threadId: thread.id,
            chatId,
            steps: [{ id: 'tool', label: 'Edit', detail: 'button.tsx', status: 'running' }],
        });
        server.emit('status', { threadId: thread.id, chatId, status: 'waiting' });
        await waitFor(() => a.last() === 'waiting');
        expect(a.steps.get('tool')).toMatchObject({
            label: 'Edit',
            status: 'running',
            startedAt: expect.any(String),
        });
        server.emit('message', {
            threadId: thread.id,
            chatId,
            message: { id: 'failure', role: 'system', text: 'Failed', streaming: false },
        });
        server.emit('status', { threadId: thread.id, chatId, status: 'error' });
        await waitFor(() => a.last() === 'error');
        expect(a.messages.get('failure')?.role).toBe('system');
    });
    it('sends follow-ups and stops only the pin chat', async () => {
        const { provider, server, thread } = await setup();
        await provider.pair();
        const created = await provider.createThread(pin);
        await provider.sendMessage({
            providerThreadId: created.providerThreadId,
            text: 'Green',
            attachments: [],
        });
        await provider.interrupt(created.providerThreadId);
        const path = `threads/${thread.id}/chats/${created.providerThreadId.split('/')[1]}`;
        expect(server.callsOf('POST', `${path}/messages`)).toEqual([
            { text: 'Green', attachments: [] },
        ]);
        expect(server.callsOf('POST', `${path}/stop`)).toEqual([{}]);
    });
    it('resumes dropped feeds with Last-Event-ID and handles full snapshots after restart', async () => {
        const { provider, server, thread } = await setup();
        await provider.pair();
        const a = record();
        provider.watch(`${thread.id}/main`, a.sink);
        await waitFor(() => a.last() === 'idle');
        const message = { id: 'reply', role: 'assistant', text: 'First', streaming: true };
        const event = server.emit('message', { threadId: thread.id, chatId: 'main', message });
        await waitFor(() => a.messages.has('reply'));
        const timestamp = a.messages.get('reply')?.createdAt;
        server.dropFeeds();
        server.emit('message', {
            threadId: thread.id,
            chatId: 'main',
            message: { ...message, text: 'Complete', streaming: false },
        });
        await waitFor(() => a.messages.get('reply')?.text === 'Complete');
        expect(server.calls.filter(c => c.path === 'feed').at(-1)?.headers['last-event-id']).toBe(
            event.id,
        );
        server.resetHistory();
        server.dropFeeds();
        server.emit('message', {
            threadId: thread.id,
            chatId: 'main',
            message: { ...message, text: 'Restarted', streaming: false },
        });
        await waitFor(() => a.messages.get('reply')?.text === 'Restarted');
        expect(a.messages.get('reply')?.createdAt).toBe(timestamp);
    });
    it('reconnects a silent feed, and follows it again for a watcher after the last one left', async () => {
        const { provider, server, thread } = await setup(true, 60);
        await provider.pair();
        const a = record();
        const unwatch = provider.watch(`${thread.id}/main`, a.sink);
        await waitFor(() => a.last() === 'idle');
        await waitFor(() => server.calls.filter(c => c.path === 'feed').length >= 2);
        unwatch();
        await waitFor(() => server.feedCount === 0);
        const b = record();
        provider.watch(`${thread.id}/main`, b.sink);
        await waitFor(() => server.feedCount === 1);
        server.emit('status', { threadId: thread.id, chatId: 'main', status: 'waiting' });
        await waitFor(() => b.last() === 'waiting');
    });
    it.each(['feed', 'write'])(
        'reports revoked auth on a %s and reconnects after re-pairing',
        async route => {
            const { provider, server, thread } = await setup();
            await provider.pair();
            const oldToken = [...server.tokens][0];
            const a = record();
            provider.watch(`${thread.id}/main`, a.sink);
            await waitFor(() => a.last() === 'idle');
            server.revoke();
            if (route === 'write')
                await expect(provider.interrupt(`${thread.id}/main`)).rejects.toThrow('401');
            await waitFor(() => provider.info().state === 'unauthorized');
            expect(provider.info().canPair).toBe(true);
            await provider.pair();
            expect(provider.info().state).toBe('ready');
            expect([...server.tokens][0]).not.toBe(oldToken);
            await waitFor(() => server.feedCount === 1);
            server.emit('status', { threadId: thread.id, chatId: 'main', status: 'waiting' });
            await waitFor(() => a.last() === 'waiting');
        },
    );
    it('marks every watched chat gone when the thread is archived', async () => {
        const { provider, server, thread } = await setup();
        await provider.pair();
        const a = record();
        const b = record();
        const pinChat = await provider.createThread(pin);
        provider.watch(`${thread.id}/main`, a.sink);
        provider.watch(pinChat.providerThreadId, b.sink);
        await waitFor(() => a.last() === 'idle');
        server.emit('archived', { threadId: thread.id });
        await waitFor(() => a.gone() && b.gone());
    });
    it('maps forwarded ports to thread identities and offers open threads in the picker', async () => {
        const { provider, server, thread, credentials } = await setup();
        await provider.pair();
        server.ports.set(4174, thread.id);
        thread.machine = { id: 'remote', name: 'Remote Mac' };
        const options = { baseUrl: server.url, credentials };
        expect(await ensembleProjectForPort(4174, options)).toBe(ensembleRoot(thread.id));
        expect(await ensembleProjectForPort(1234, options)).toBeUndefined();
        expect(await listEnsembleProjects(options)).toEqual([
            { workspaceRoot: ensembleRoot(thread.id), title: 'Landing' },
        ]);
    });
});
