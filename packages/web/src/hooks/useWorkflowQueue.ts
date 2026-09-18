import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';

// Live via SSE: useSSE invalidates ['workflow-queue'] on `workflow_run_updated`
// (runs start, move, park, finish) and `counts_changed` (Tasks change status or
// workflow; a workflow is paused).
export function useWorkflowQueue(projectId?: string | null) {
    return useQuery({
        queryKey: ['workflow-queue', projectId ?? null],
        queryFn: () => api.workflowQueue.get(projectId ?? undefined),
    });
}
