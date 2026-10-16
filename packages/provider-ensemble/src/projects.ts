import { EnsembleClient } from './api.ts';
import { defaultEnsembleDir, ensembleUrl } from './locate.ts';

export interface EnsembleProjectSummary {
    workspaceRoot: string;
    title: string;
}

/** Ensemble's projects that are folders on this machine; empty when Ensemble isn't running. */
export async function listEnsembleProjects(
    options: { baseUrl?: string; ensembleDir?: string } = {},
): Promise<EnsembleProjectSummary[]> {
    const baseUrl =
        options.baseUrl ?? (await ensembleUrl(options.ensembleDir ?? defaultEnsembleDir()));
    if (!baseUrl) return [];
    const projects = await new EnsembleClient({ baseUrl, requestTimeoutMs: 1_500 }).projects();
    return projects
        .filter(project => project.remote.startsWith('/') || /^[a-z]:[\\/]/i.test(project.remote))
        .map(project => ({ workspaceRoot: project.remote, title: project.name }));
}
