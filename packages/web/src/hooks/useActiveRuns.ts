import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Header mascot needs a "is any agent working right now?" signal. The same
// ['runs','all'] queryKey is already populated by Agents.tsx / Queue.tsx and
// is auto-invalidated by useSSE on `run_queued`, `agent_status`,
// `run_completed`, and `run_error` events — so subscribing here gives us a
// live state flip without any new transport or polling.
//
// Audit 2026-06-09 (B2) — `refetchOnMount: false`. Topbar mounts once per
// session; child component remounts during page navigation were re-firing
// the ~6KB GET /api/run?limit=500 fetch on every page despite staleTime.
// SSE keeps the cache fresh via invalidation on run lifecycle events, so
// the no-mount-refetch path is safe.
export function useActiveRuns(): { hasActiveRuns: boolean; count: number } {
    const { data } = useQuery({
        queryKey: ['runs', 'all'],
        queryFn: () => api.run.list({ limit: 500 }),
        staleTime: 30_000,
        refetchOnMount: false,
    });
    const active = (data ?? []).filter(
        (r) => r.status === 'queued' || r.status === 'in_progress',
    );
    return { hasActiveRuns: active.length > 0, count: active.length };
}
