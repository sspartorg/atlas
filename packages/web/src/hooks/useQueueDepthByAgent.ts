import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

/**
 * Ready + in-progress items per assignee, counted by the API.
 *
 * Keyed under `tasks` so every event that refreshes the task lists refreshes
 * this too. It used to fetch every Task and sub-task to count them here.
 */
export function useQueueDepthByAgent(): Map<string, number> {
    const { data } = useQuery({ queryKey: ['tasks', 'queue-depth'], queryFn: () => api.counts.queueByAgent() });
    return useMemo(() => new Map(Object.entries(data ?? {})), [data]);
}
