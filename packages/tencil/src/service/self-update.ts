import { spawn, spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { withoutNpmEnv } from '@tencildev/provider-t3code';
import { cliIn, installArgs, runtimeCli, runtimeDir } from './autostart.ts';
import { spawnDaemon, stopDaemon, waitForDaemon } from './background.ts';
import type { DaemonCommand } from './daemon-command.ts';
import { installService, isServiceInstalled } from './login-service.ts';

/**
 * Updating from the overlay. The daemon installs the new version next to the
 * runtime (`runtime.next`), then hands off to a helper process, since a
 * login service's daemon can't restart itself: stopping it ends the
 * service. The helper swaps the copies, restarts the daemon on the new one
 * and keeps the old copy (`runtime.previous`) until the new daemon answers.
 * If it doesn't, the old copy goes back and the old daemon is restarted.
 */
export function stagingDir(dataDir: string, port?: number): string {
    return `${runtimeDir(dataDir, port)}.next`;
}

export function previousDir(dataDir: string, port?: number): string {
    return `${runtimeDir(dataDir, port)}.previous`;
}

/** Why the last update was rolled back, for the restarted old daemon to report. */
export function failureFile(dataDir: string, port?: number): string {
    return `${runtimeDir(dataDir, port)}.failed.json`;
}

function planFile(dataDir: string, port?: number): string {
    return `${runtimeDir(dataDir, port)}.update.json`;
}

/** Installs a package spec into a folder, like `npm install --prefix dir spec`. */
export type Installer = (spec: string, dir: string) => Promise<void>;

/** The setup way (`runtimeInstallArgs`), without blocking the daemon while npm runs. */
export const npmInstall: Installer = (spec, dir) =>
    new Promise((resolve, reject) => {
        const child = spawn(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            installArgs(dir, spec),
            {
                stdio: ['ignore', 'ignore', 'pipe'],
                shell: process.platform === 'win32',
                env: withoutNpmEnv(),
                windowsHide: true,
            },
        );
        let stderr = '';
        child.stderr?.on('data', chunk => {
            stderr = (stderr + String(chunk)).slice(-2_000);
        });
        const timer = setTimeout(() => child.kill(), 5 * 60_000);
        child.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('close', code => {
            clearTimeout(timer);
            if (code === 0) return resolve();
            const lines = stderr.trim().split('\n').slice(-3).join(' ');
            reject(
                new Error(`npm install failed (${code ?? 'killed'})${lines ? `: ${lines}` : ''}`),
            );
        });
    });

/** Install `version` into the staging folder. Returns its CLI. */
export async function stageUpdate(
    version: string,
    options: { dataDir: string; port?: number; install?: Installer },
): Promise<string> {
    const dir = stagingDir(options.dataDir, options.port);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await (options.install ?? npmInstall)(`tencil@${version}`, dir);
    const installed = installedVersion(dir);
    if (installed !== version) {
        rmSync(dir, { recursive: true, force: true });
        throw new Error(
            `Installed ${installed ? `Tencil ${installed}` : 'nothing'}, not ${version}`,
        );
    }
    return cliIn(dir);
}

function installedVersion(dir: string): string | undefined {
    try {
        const pkg = JSON.parse(
            readFileSync(join(dir, 'node_modules', 'tencil', 'package.json'), 'utf8'),
        ) as { version?: string };
        return existsSync(cliIn(dir)) ? pkg.version : undefined;
    } catch {
        return undefined;
    }
}

/** What the helper needs to move the daemon on `port` to the staged `version`. */
export interface UpdatePlan {
    version: string;
    port: number;
    dataDir: string;
    node: string;
    /** The running daemon's flags, kept by the new one. */
    flags: string[];
    /** The CLI the running daemon was started from, to go back to on failure. */
    previousCli: string;
}

/**
 * Start the helper (`tencil finish-update`) from `cli`, detached so it
 * outlives this daemon. On Linux a service's processes all stop with it,
 * so the helper gets its own scope there.
 */
export function handOffUpdate(plan: UpdatePlan, cli: string): void {
    const file = planFile(plan.dataDir, plan.port);
    writeFileSync(file, JSON.stringify(plan, null, 2));
    const args = [cli, 'finish-update', file];
    const scoped =
        process.platform === 'linux' &&
        isServiceInstalled(plan.port) &&
        spawnSync('systemd-run', ['--version'], { stdio: 'ignore' }).status === 0;
    const logFile = openSync(join(plan.dataDir, 'daemon.log'), 'a');
    const child = spawn(
        scoped ? 'systemd-run' : plan.node,
        scoped ? ['--user', '--scope', '--collect', '--quiet', plan.node, ...args] : args,
        { detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true },
    );
    child.unref();
}

export function readPlan(file: string): UpdatePlan {
    return JSON.parse(readFileSync(file, 'utf8')) as UpdatePlan;
}

/** Restart the daemon on `command.cli`: through the login service if there is one. */
export async function restartDaemon(command: DaemonCommand, dataDir: string): Promise<void> {
    if (isServiceInstalled(command.port)) {
        // Replaces the old daemon, and keeps the new one across logins.
        await installService(command, dataDir);
        return;
    }
    await stopDaemon(command.port);
    spawnDaemon(command, dataDir);
}

/**
 * The helper's job. Returns whether the daemon now runs `plan.version`;
 * when it doesn't, the old version runs again and the reason is in
 * `failureFile`.
 */
export async function finishUpdate(
    plan: UpdatePlan,
    options: {
        restart?: (command: DaemonCommand, dataDir: string) => Promise<void>;
        /** Health checks, 100 ms apart, before giving up on the new daemon. */
        attempts?: number;
    } = {},
): Promise<boolean> {
    const { dataDir, port } = plan;
    const restart = options.restart ?? restartDaemon;
    const attempts = options.attempts ?? 300;
    const current = runtimeDir(dataDir, port);
    const previous = previousDir(dataDir, port);
    const command = (cli: string): DaemonCommand => ({
        node: plan.node,
        cli,
        port,
        args: plan.flags,
    });
    rmSync(planFile(dataDir, port), { force: true });
    rmSync(failureFile(dataDir, port), { force: true });
    rmSync(previous, { recursive: true, force: true });
    const hadRuntime = existsSync(current);
    try {
        if (hadRuntime) renameSync(current, previous);
        renameSync(stagingDir(dataDir, port), current);
        await restart(command(runtimeCli(dataDir, port)), dataDir);
        await waitForDaemon(port, dataDir, plan.version, attempts);
        rmSync(previous, { recursive: true, force: true });
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeFileSync(
            failureFile(dataDir, port),
            JSON.stringify({ version: plan.version, error: message }),
        );
        if (existsSync(previous)) {
            rmSync(current, { recursive: true, force: true });
            renameSync(previous, current);
        } else if (!hadRuntime) {
            rmSync(current, { recursive: true, force: true });
        }
        await restart(command(plan.previousCli), dataDir).catch(() => {});
        await waitForDaemon(port, dataDir, undefined, attempts).catch(() => {});
        return false;
    }
}

/** The rolled-back update's version and error, read once by the daemon that runs again. */
export function takeUpdateFailure(
    dataDir: string,
    port?: number,
): { version: string; error: string } | undefined {
    const file = failureFile(dataDir, port);
    try {
        const failure = JSON.parse(readFileSync(file, 'utf8')) as {
            version: string;
            error: string;
        };
        rmSync(file, { force: true });
        return failure;
    } catch {
        return undefined;
    }
}
