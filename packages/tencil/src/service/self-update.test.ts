import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cliIn, runtimeCli, runtimeDir } from './autostart.ts';
import type { DaemonCommand } from './daemon-command.ts';
import {
    finishUpdate,
    type Installer,
    previousDir,
    stageUpdate,
    stagingDir,
    takeUpdateFailure,
} from './self-update.ts';

/** Stands in for `npm install --prefix dir tencil@x`: writes a package that says it's x. */
function fakeInstall(installs: string[] = []): Installer {
    return async (spec, dir) => {
        installs.push(spec);
        writeTencil(dir, spec.replace('tencil@', ''));
    };
}

function writeTencil(dir: string, version: string): void {
    mkdirSync(join(dir, 'node_modules', 'tencil', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'tencil', 'package.json'), JSON.stringify({ version }));
    writeFileSync(cliIn(dir), `// tencil ${version}\n`);
}

const versionIn = (dir: string) =>
    (
        JSON.parse(readFileSync(join(dir, 'node_modules', 'tencil', 'package.json'), 'utf8')) as {
            version: string;
        }
    ).version;

const servers: Server[] = [];
afterEach(() => {
    for (const server of servers.splice(0)) server.close();
});

/** A port where a fake daemon answers /health with whatever version `restart` started. */
async function fakeDaemonPort(): Promise<{ port: number; running: { version?: string } }> {
    const running: { version?: string } = {};
    const server = createServer((_request, response) => {
        if (!running.version) {
            response.writeHead(503);
            return void response.end();
        }
        response.end(JSON.stringify({ name: 'tencil', version: running.version, pid: 1 }));
    });
    servers.push(server);
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    return { port: (server.address() as AddressInfo).port, running };
}

describe('updating the runtime copy', () => {
    const dataDir = () => mkdtempSync(join(tmpdir(), 'tencil-update-'));

    it('installs the new version next to the runtime, not over it', async () => {
        const dir = dataDir();
        writeTencil(runtimeDir(dir, 4800), '0.1.0');
        const installs: string[] = [];
        const cli = await stageUpdate('0.2.0', {
            dataDir: dir,
            port: 4800,
            install: fakeInstall(installs),
        });
        expect(installs).toEqual(['tencil@0.2.0']);
        expect(cli).toBe(cliIn(stagingDir(dir, 4800)));
        expect(versionIn(runtimeDir(dir, 4800))).toBe('0.1.0');
    });

    it("fails when the install doesn't give the expected version", async () => {
        const dir = dataDir();
        await expect(
            stageUpdate('0.2.0', {
                dataDir: dir,
                install: async (_spec, target) => writeTencil(target, '0.1.9'),
            }),
        ).rejects.toThrow('Installed Tencil 0.1.9, not 0.2.0');
        await expect(
            stageUpdate('0.2.0', {
                dataDir: dir,
                install: async () => {
                    throw new Error('npm install failed (1): E404');
                },
            }),
        ).rejects.toThrow('E404');
    });

    it('swaps in the new copy and drops the old one once the new daemon answers', async () => {
        const dir = dataDir();
        const { port, running } = await fakeDaemonPort();
        writeTencil(runtimeDir(dir, port), '0.1.0');
        await stageUpdate('0.2.0', { dataDir: dir, port, install: fakeInstall() });
        const restarts: DaemonCommand[] = [];
        const updated = await finishUpdate(
            {
                version: '0.2.0',
                port,
                dataDir: dir,
                node: 'node',
                flags: ['--listen', '100.64.0.1'],
                previousCli: runtimeCli(dir, port),
            },
            {
                attempts: 20,
                restart: async command => {
                    restarts.push(command);
                    running.version = readFileSync(command.cli, 'utf8').match(/[\d.]+/)?.[0];
                },
            },
        );
        expect(updated).toBe(true);
        expect(restarts).toEqual([
            { node: 'node', cli: runtimeCli(dir, port), port, args: ['--listen', '100.64.0.1'] },
        ]);
        expect(versionIn(runtimeDir(dir, port))).toBe('0.2.0');
        expect(() => versionIn(previousDir(dir, port))).toThrow();
        expect(takeUpdateFailure(dir, port)).toBeUndefined();
    });

    it("goes back to the old copy and daemon when the new one doesn't answer", async () => {
        const dir = dataDir();
        const { port, running } = await fakeDaemonPort();
        writeTencil(runtimeDir(dir, port), '0.1.0');
        await stageUpdate('0.2.0', { dataDir: dir, port, install: fakeInstall() });
        const started: string[] = [];
        const updated = await finishUpdate(
            {
                version: '0.2.0',
                port,
                dataDir: dir,
                node: 'node',
                flags: [],
                previousCli: '/old/tencil/cli.mjs',
            },
            {
                attempts: 5,
                restart: async command => {
                    started.push(command.cli);
                    // The new version crashes on start; the old one comes back.
                    if (command.cli === '/old/tencil/cli.mjs') running.version = '0.1.0';
                },
            },
        );
        expect(updated).toBe(false);
        expect(started).toEqual([runtimeCli(dir, port), '/old/tencil/cli.mjs']);
        expect(versionIn(runtimeDir(dir, port))).toBe('0.1.0');
        expect(takeUpdateFailure(dir, port)).toEqual({
            version: '0.2.0',
            error: expect.stringContaining("daemon didn't start"),
        });
        // Read once: the next daemon doesn't report it again.
        expect(takeUpdateFailure(dir, port)).toBeUndefined();
    });
});
