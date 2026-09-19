import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Under ['projects', id] so the project refresh button and the SSE
// `clone_completed` invalidation of ['projects'] cover it too.
const reposKey = (projectId: string) => ['projects', projectId, 'repos'];

export function useProjectRepos(projectId: string) {
    return useQuery({
        queryKey: reposKey(projectId),
        queryFn: () => api.projects.repos(projectId),
        enabled: Boolean(projectId),
    });
}

/** Starts the clone; the repo appears on `clone_completed` (see `useCloneJob`). */
export function useCloneProjectRepo(projectId: string) {
    return useMutation({
        mutationFn: (data: Parameters<typeof api.projects.cloneRepo>[1]) =>
            api.projects.cloneRepo(projectId, data),
    });
}

/** Resolves with the raw `{ ok, body }` so a failed check can render its ConnectError. */
export function useConnectProjectRepo(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Parameters<typeof api.projects.connectRepo>[1]) =>
            api.projects.connectRepo(projectId, data),
        onSuccess: (res) => {
            if (res.ok) void qc.invalidateQueries({ queryKey: reposKey(projectId) });
        },
    });
}

export function useUpdateProjectRepo(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            repoId,
            data,
        }: {
            repoId: string;
            data: Parameters<typeof api.projects.updateRepo>[2];
        }) => api.projects.updateRepo(projectId, repoId, data),
        onSuccess: () => void qc.invalidateQueries({ queryKey: reposKey(projectId) }),
    });
}

export function useRemoveProjectRepo(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (repoId: string) => api.projects.removeRepo(projectId, repoId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: reposKey(projectId) });
            // Removing a repo drops it from every Task that picked it.
            void qc.invalidateQueries({ queryKey: ['tasks'] });
        },
    });
}
