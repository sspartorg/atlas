import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Batch-9 audit (enterprise-secrets read model). See
// hooks/useEnvironmentSecrets.ts for the same shape at global scope.

/** A row to save: a new value, or keep: an existing key whose stored value it keeps. */
export type EnvSaveRow = { key: string; value: string } | { key: string; keep: string };

export function useProjectEnv(projectId: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: ['projects', projectId, 'env'],
        queryFn: () => api.projects.getEnv(projectId!),
        enabled: Boolean(projectId) && enabled,
    });
}

export function useSaveProjectEnv(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars: EnvSaveRow[]) => api.projects.saveEnv(projectId, vars),
        onSuccess: (data) => {
            qc.setQueryData(['projects', projectId, 'env'], data);
        },
    });
}

/**
 * On-demand reveal for one project env var. Returns a mutation — the
 * plaintext MUST NOT be cached. See useRevealEnvironmentSecret.
 */
export function useRevealProjectEnv(projectId: string) {
    return useMutation({
        mutationFn: (key: string) => api.projects.revealEnv(projectId, key),
    });
}
