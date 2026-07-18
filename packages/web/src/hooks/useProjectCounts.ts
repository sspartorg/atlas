import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Single-shot KPI fetch for the Project Detail Overview tab. Replaces the
// previous fan-out of useEpics + useStories + useBugs whose only purpose was
// to count rows client-side. The endpoint runs 7 small COUNT() queries in
// parallel on the server and returns one JSON envelope.
export function useProjectCounts(projectId: string) {
    return useQuery({
        queryKey: ['projects', projectId, 'counts'],
        queryFn: () => api.counts.project(projectId),
        enabled: projectId.length > 0,
    });
}
