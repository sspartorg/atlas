import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type JiraConfigUpdate, type JiraSourceInput } from '../api/api.js';

const KEY = ['integrations', 'jira'] as const;

export function useJiraConfig() {
    return useQuery({ queryKey: KEY, queryFn: () => api.jira.get() });
}

export function useUpdateJiraConfig() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: JiraConfigUpdate) => api.jira.update(data),
        onSuccess: (cfg) => qc.setQueryData(KEY, cfg),
    });
}

export function useTestJira() {
    return useMutation({ mutationFn: () => api.jira.test() });
}

export function useSyncJira() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.jira.sync(),
        // A sync creates Tasks and notifications and stamps last_sync_*.
        onSettled: () => qc.invalidateQueries(),
    });
}

// ── Per-project sources (migration 010) ─────────────────────────────────────
// Keyed like useProjectRepos so a project's tab refetches on its own.
const sourcesKey = (projectId: string) => ['projects', projectId, 'jira-sources'] as const;

export function useProjectJiraSources(projectId: string) {
    return useQuery({
        queryKey: sourcesKey(projectId),
        queryFn: () => api.jiraSources.list(projectId),
    });
}

export function useCreateJiraSource(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: JiraSourceInput) => api.jiraSources.create(projectId, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: sourcesKey(projectId) }),
    });
}

export function useUpdateJiraSource(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<JiraSourceInput> }) =>
            api.jiraSources.update(projectId, id, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: sourcesKey(projectId) }),
    });
}

export function useDeleteJiraSource(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => api.jiraSources.remove(projectId, id),
        onSuccess: () => qc.invalidateQueries({ queryKey: sourcesKey(projectId) }),
    });
}
