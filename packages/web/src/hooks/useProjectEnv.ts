import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Batch-9 audit (enterprise-secrets read model). See
// hooks/useEnvironmentSecrets.ts for the same shape at global scope.
export interface IProjectEnvVar {
    key: string;
    value: string;
}

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
        mutationFn: (vars: IProjectEnvVar[]) => api.projects.saveEnv(projectId, vars),
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
