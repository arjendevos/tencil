import { VERSION } from '../version.ts';

/** Compare dotted versions by number (pre-release tags ignored): below 0, 0 or above 0. */
export function compareVersions(a: string, b: string): number {
    const parts = (version: string) => version.split('-')[0]?.split('.').map(Number) ?? [];
    const [left, right] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
    }
    return 0;
}

/**
 * npx reuses what it cached for `npx tencil`, so an older Tencil can run after
 * a newer one was set up. It must never replace that newer daemon.
 */
export function isNewerThanThis(version: string | undefined): boolean {
    return version !== undefined && compareVersions(version, VERSION) > 0;
}

export class NewerDaemonError extends Error {
    constructor(running: string) {
        super(
            `Tencil ${running} is already running and this is ${VERSION}, which is older. Run \`npx tencil@latest\` instead.`,
        );
        this.name = 'NewerDaemonError';
    }
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** Where to look Tencil up: npm, or `TENCIL_REGISTRY_URL` (a mirror, a test registry). */
export function registryUrl(env: NodeJS.ProcessEnv = process.env): string {
    return (env.TENCIL_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

/**
 * Machines that shouldn't phone home: `TENCIL_NO_UPDATE_CHECK` is set, or
 * it's CI. Neither the CLI nor the daemon asks the registry then.
 */
export function updateChecksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const set = (value: string | undefined) =>
        value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
    return set(env.TENCIL_NO_UPDATE_CHECK) || set(env.CI);
}

/** The newest published Tencil, or undefined when the registry doesn't answer quickly. */
export async function latestVersion(
    options: { registry?: string; timeoutMs?: number } = {},
): Promise<string | undefined> {
    const response = await fetch(`${options.registry ?? registryUrl()}/tencil/latest`, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 1_500),
    }).catch(() => undefined);
    if (!response?.ok) return undefined;
    const body = (await response.json().catch(() => undefined)) as { version?: string } | undefined;
    return typeof body?.version === 'string' ? body.version : undefined;
}

/** A one-line nudge when a newer Tencil is published. */
export async function updateNotice(): Promise<string | undefined> {
    if (updateChecksDisabled()) return undefined;
    const latest = await latestVersion();
    return latest && isNewerThanThis(latest)
        ? `Tencil ${latest} is out (this is ${VERSION}): npx tencil@latest`
        : undefined;
}
