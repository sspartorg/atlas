import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

// "Is any agent working right now, and which?" — the header mascot and the
// dashboard's fleet strip and roster. Asks the API for queued/in-progress
// runs only. Under the ['runs'] prefix, which useSSE invalidates on
// `run_queued`, `agent_status`, `run_completed` and `run_error`, so the state
// flips live without polling.
//
// Audit 2026-06-09 (B2) — `refetchOnMount: false`. Topbar mounts once per
// session; child component remounts during page navigation were re-firing
// the fetch on every page despite staleTime. SSE keeps the cache fresh via
// invalidation on run lifecycle events, so the no-mount-refetch path is safe.
export function useActiveRuns(): {
    hasActiveRuns: boolean;
    count: number;
    /** Agents with a queued or in-progress run. */
    agentIds: Set<string>;
} {
    const { data } = useQuery({
        // Only the live runs: paging the last 500 runs to find the few that
        // are queued or running cost ~180 KB on every cold load. Still under
        // ['runs'], so useSSE's run-event invalidation keeps it live.
        queryKey: ['runs', 'active'],
        queryFn: () => api.run.list({ status: ['queued', 'in_progress'], limit: 500 }),
        staleTime: 30_000,
        refetchOnMount: false,
    });
    const active = (data ?? []).filter(
        (r) => r.status === 'queued' || r.status === 'in_progress',
    );
    return {
        hasActiveRuns: active.length > 0,
        count: active.length,
        agentIds: new Set(active.map((r) => r.agent_id)),
    };
}
