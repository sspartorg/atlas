import { useQuery } from '@tanstack/react-query';
import type { AnalyticsWindow } from '@atlas/shared';
import { api } from '../api/api.js';

// Analytics hooks. Each /analytics tab mounts only while active and calls only
// the hooks it shows, so opening Spend never fetches delivery or workflows.
// All three keys share the 'analytics' prefix, so one
// invalidateQueries(['analytics']) refreshes them.

const STALE = 30_000;

export function useAnalyticsSpend(window: AnalyticsWindow) {
    return useQuery({
        queryKey: ['analytics', window],
        queryFn: () => api.analytics.get(window),
        staleTime: STALE,
    });
}

export function useAnalyticsDelivery(window: AnalyticsWindow) {
    return useQuery({
        queryKey: ['analytics', 'delivery', window],
        queryFn: () => api.analytics.delivery(window),
        staleTime: STALE,
    });
}

export function useAnalyticsWorkflows(window: AnalyticsWindow) {
    return useQuery({
        queryKey: ['analytics', 'workflows', window],
        queryFn: () => api.analytics.workflows(window),
        staleTime: STALE,
    });
}
