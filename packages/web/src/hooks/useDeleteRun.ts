import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

// P9 — TanStack mutation around DELETE /api/run/:id. The server-side
// handler removes the row (cascading any reviewer child run), drops
// sibling queued/in_progress runs on the same item, and resets the
// item back to `ready` with assignee cleared. We invalidate every
// query key that materializes a run list or item snapshot so the UI
// refreshes immediately:
//
//   ['agents', agentId, 'runs']          — Agent Detail Runs tab
//   ['runs']                             — every run list: project History /
//                                          Recent activity, item runs, active runs
//   ['agents']                           — sidenav counts / activity
//   ['tasks' / 'sub-tasks']              — broad invalidate, the
//      affected item is unknown to the caller (DELETE returns 204)
//      so we pull on every item kind. Cheap — TanStack only refetches
//      mounted queries.
export function useDeleteRun(agentId: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (runId: string) => api.run.delete(runId),
        onSuccess: (_data, runId) => {
            void qc.invalidateQueries({ queryKey: ['agents', agentId, 'runs'] });
            void qc.invalidateQueries({ queryKey: ['runs'] });
            void qc.invalidateQueries({ queryKey: ['agents'] });
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            // The run-detail query (['agent-run', runId]) kept the deleted
            // row until manual navigation; `removeQueries` evicts it.
            qc.removeQueries({ queryKey: ['agent-run', runId] });
            void qc.invalidateQueries({ queryKey: ['items'] });
        },
    });
}
