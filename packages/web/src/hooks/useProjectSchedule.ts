import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

const key = (repoId: string) => ['repo-schedule', repoId];
const listKey = ['schedules-enabled'];

export function useEnabledSchedules() {
    const q = useQuery({
        queryKey: listKey,
        queryFn: () => api.schedules.listEnabled(),
    });
    const map = useMemo(() => {
        // ADR 0018 — keyed by repo: a project can have a schedule per repo.
        const m = new Map<string, { preset: string; next_run_at: string | null }>();
        for (const s of q.data ?? [])
            m.set(s.repo_id, { preset: s.preset, next_run_at: s.next_run_at });
        return m;
    }, [q.data]);
    return { ...q, map };
}

export function useRepoSchedule(projectId: string | null, repoId: string | null) {
    return useQuery({
        queryKey: key(repoId ?? '__none__'),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `enabled` gates on both ids
        queryFn: () => api.schedules.get(projectId!, repoId!),
        enabled: Boolean(projectId && repoId),
    });
}

export function useSaveRepoSchedule(projectId: string, repoId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Parameters<typeof api.schedules.save>[2]) =>
            api.schedules.save(projectId, repoId, data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: key(repoId) });
            void qc.invalidateQueries({ queryKey: listKey });
        },
    });
}

export function useFireRepoSchedule(projectId: string, repoId: string) {
    return useMutation({
        mutationFn: () => api.schedules.fire(projectId, repoId),
    });
}
