import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type JiraConfigUpdate } from '../api/api.js';

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

/** Every repo of every project, for the Jira source picker. */
export function useAllRepos() {
    return useQuery({ queryKey: ['repos'], queryFn: () => api.repos.listAll() });
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
