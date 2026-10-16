import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

const BUNDLE_ID = 'studio.terrabyte.ensemble';

/**
 * Where the Ensemble app keeps its local host: the port it listens on, its
 * database and one workspace per thread (`threads/<id>/workspace`).
 */
export function defaultEnsembleDir(): string {
    if (process.env.TENCIL_ENSEMBLE_DIR) return process.env.TENCIL_ENSEMBLE_DIR;
    const home = homedir();
    const appData =
        process.platform === 'darwin'
            ? join(home, 'Library', 'Application Support')
            : process.platform === 'win32'
              ? (process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
              : (process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'));
    return join(appData, BUNDLE_ID, 'local-host');
}

/** The local host's URL, from the port it wrote on start. Undefined when Ensemble never ran. */
export async function ensembleUrl(dir = defaultEnsembleDir()): Promise<string | undefined> {
    if (process.env.TENCIL_ENSEMBLE_URL) return process.env.TENCIL_ENSEMBLE_URL;
    const raw = await readFile(join(dir, 'listen-port'), 'utf8').catch(() => undefined);
    const port = Number(raw?.trim());
    return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}` : undefined;
}

/**
 * The Ensemble thread whose workspace holds `path`, if any. Dev servers
 * Ensemble starts for a thread run there, so their pages belong to it.
 */
export function threadForPath(path: string, dir = defaultEnsembleDir()): string | undefined {
    const rel = relative(join(dir, 'threads'), path);
    if (rel.startsWith('..') || rel === '') return undefined;
    const [id, workspace] = rel.split(sep);
    return id && workspace === 'workspace' ? id : undefined;
}
