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
//   ['projects', ?, 'agent-runs']        — Project History tab
//   ['runs']                             — any future global run view
//   ['agents']                           — sidenav counts / activity
//   ['epics' / 'stories' / 'bugs' …]     — broad invalidate, the
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
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            void qc.invalidateQueries({ queryKey: ['sub-bugs'] });
            // Follow-up audit: the run-detail query (['agent-run', runId])
            // and any item-scoped agent-runs list (['items', itemId,
            // 'agent-runs']) previously kept the deleted row in the cache
            // until manual navigation. `removeQueries` on the specific
            // run-detail key evicts it immediately; the item-level
            // list is broad-invalidated via the parent prefixes below.
            qc.removeQueries({ queryKey: ['agent-run', runId] });
            void qc.invalidateQueries({ queryKey: ['items'] });
        },
    });
}
