import { computed, signal } from '@preact/signals';
import type { UpdateStatus } from '@tencildev/protocol';
import { daemonVersion, isCloud, send, update, updatedFrom } from '../lib/connection.ts';

const CHANGELOG_URL =
    'https://github.com/tencildev/tencil/blob/master/packages/tencil/CHANGELOG.md';
const MANUAL_UPDATE = 'npx tencil@latest setup';

/** A newer Tencil is out and nothing is being done about it yet: the settings button shows a dot. */
export const updateAvailable = computed(
    () => !isCloud() && !!update.value?.latest && update.value.state === 'idle',
);

const copied = signal(false);

/**
 * The running Tencil version and its updates: "x.y.z is available", the
 * Update button and its progress, or what went wrong with the command to run
 * instead. Local daemon only; Tencil Cloud runs its own bridge.
 */
export function AboutSection() {
    const version = daemonVersion.value;
    if (isCloud() || !version) return null;
    const status = update.value;
    const busy =
        status?.state === 'installing' ||
        status?.state === 'waiting' ||
        status?.state === 'restarting';
    const previous = updatedFrom.value;

    return (
        <section class="settings-section settings-about" aria-label="About Tencil">
            <div class="settings-about-row">
                <span class="settings-label">Tencil</span>
                <span class="settings-version">v{version}</span>
            </div>
            {previous && previous !== version && !status?.latest && (
                <p class="settings-help">Updated from v{previous}.</p>
            )}
            {status?.latest && (
                <div class="settings-update">
                    <p class="settings-help">
                        <strong>Tencil {status.latest} is available.</strong>{' '}
                        <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
                            What's new
                        </a>
                    </p>
                    {busy && <p class="settings-help settings-progress">{progress(status)}</p>}
                    <button
                        type="button"
                        class="hint-action settings-update-button"
                        disabled={busy}
                        onClick={() => send({ type: 'update.start' })}
                    >
                        {busy ? 'Updating…' : status.state === 'failed' ? 'Try again' : 'Update'}
                    </button>
                </div>
            )}
            {status?.state === 'failed' && (
                <div class="settings-update-error" role="alert">
                    <p class="settings-help">
                        Couldn't update{status.error ? `: ${status.error}` : '.'} Tencil {version}{' '}
                        is still running. Update from a terminal instead:
                    </p>
                    <div class="settings-command">
                        <code>{MANUAL_UPDATE}</code>
                        <button
                            type="button"
                            class="settings-copy"
                            onClick={() => {
                                void navigator.clipboard?.writeText(MANUAL_UPDATE).then(() => {
                                    copied.value = true;
                                    setTimeout(() => {
                                        copied.value = false;
                                    }, 1_500);
                                });
                            }}
                        >
                            {copied.value ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

function progress(status: UpdateStatus): string {
    switch (status.state) {
        case 'installing':
            return `Installing Tencil ${status.latest}…`;
        case 'waiting': {
            const count = status.running ?? 1;
            return `Waiting for ${count} running ${count === 1 ? 'thread' : 'threads'} to finish…`;
        }
        default:
            return `Restarting on Tencil ${status.latest}…`;
    }
}
