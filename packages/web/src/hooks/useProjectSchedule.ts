import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

const key = (projectId: string) => ['project-schedule', projectId];
const listKey = ['schedules-enabled'];

export function useEnabledSchedules() {
    const q = useQuery({
        queryKey: listKey,
        queryFn: () => api.schedules.listEnabled(),
    });
    const map = useMemo(() => {
        const m = new Map<string, { preset: string; next_run_at: string | null }>();
        for (const s of q.data ?? [])
            m.set(s.project_id, { preset: s.preset, next_run_at: s.next_run_at });
        return m;
    }, [q.data]);
    return { ...q, map };
}

export function useProjectSchedule(projectId: string | null) {
    return useQuery({
        queryKey: key(projectId ?? '__none__'),
        queryFn: () => api.schedules.get(projectId!),
        enabled: Boolean(projectId),
    });
}

export function useSaveProjectSchedule(projectId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Parameters<typeof api.schedules.save>[1]) =>
            api.schedules.save(projectId, data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: key(projectId) });
            void qc.invalidateQueries({ queryKey: listKey });
        },
    });
}

export function useFireProjectSchedule(projectId: string) {
    return useMutation({
        mutationFn: () => api.schedules.fire(projectId),
    });
}
