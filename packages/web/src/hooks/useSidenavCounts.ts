import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { SidenavCounts } from '../api/types.js';

const EMPTY_COUNTS: SidenavCounts = {
    projects: 0,
    epics: 0,
    issues: 0,
    queue: 0,
    agents: 0,
    notifications: 0,
};

// Sidenav counts are SSE-driven: useSSE.ts invalidates ['sidenav-counts']
// on every event that changes them (counts_changed, run_queued / run_completed
// / run_error, clone_completed, notification_created / notification_updated).
// Long-cache is correct — re-fetching on every navigation just to read the
// same numbers is pure waste.
export function useSidenavCounts() {
    const { data } = useQuery<SidenavCounts>({
        queryKey: ['sidenav-counts'],
        queryFn: () => api.counts.sidenav(),
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        // Override the global `refetchOnMount: 'always'` default — see
        // useSettings.ts for the full rationale. SSE invalidates on every
        // event that changes counts.
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
    return data ?? EMPTY_COUNTS;
}
