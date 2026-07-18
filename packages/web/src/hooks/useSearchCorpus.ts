import { useQuery } from '@tanstack/react-query';
import type { ISubBug, ISubTask } from '@atlas/shared';
import { api } from '../api/api.js';

// One API call per hook (GET /api/sub-tasks, GET /api/sub-bugs) instead of
// N parallel calls (one per story) — the same data, dramatically fewer
// requests on every issue-detail page that renders RelatedItemsCard.
export function useAllSubTasks() {
    const q = useQuery<ISubTask[]>({
        queryKey: ['sub-tasks'],
        queryFn: () => api.subTasks.list(),
    });
    return { data: q.data ?? [], isLoading: q.isLoading };
}

export function useAllSubBugs() {
    const q = useQuery<ISubBug[]>({
        queryKey: ['sub-bugs'],
        queryFn: () => api.subBugs.list(),
    });
    return { data: q.data ?? [], isLoading: q.isLoading };
}

// Sentinel hook so React Query batches stories fetch alongside other queries.
export function useSearchPing() {
    return useQuery({
        queryKey: ['search-ping'],
        queryFn: () => Promise.resolve(true),
    });
}
