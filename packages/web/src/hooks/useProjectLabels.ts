import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';

interface UseProjectLabelsOpts {
    /**
     * Set true on callers that explicitly want the workspace-wide
     * suggestion pool (e.g. the Search page's Labels filter chip).
     * Without this, an undefined `projectId` is treated as "still
     * loading" and the query stays disabled — preventing the
     * detail-page double-fire where the workspace query runs first
     * and then the project-scoped query immediately after `project`
     * resolves.
     */
    workspace?: boolean;
}

// Task 1 — project-scoped label suggestions used by the LabelsRailRow
// on item-detail pages, the LabelsFormField on creation forms, and the
// Labels filter chip on the Search page.
//
// Short staleTime + manual invalidation: every time an item's labels
// change we want the suggestion pool to pick up the new string on the
// very next render. 30 s gives just enough cushion for back-to-back
// edits to share a single fetch.
export function useProjectLabels(
    projectId: string | undefined,
    opts: UseProjectLabelsOpts = {},
) {
    const enabled = projectId !== undefined || opts.workspace === true;
    return useQuery({
        queryKey: ['labels', projectId ?? '_all'],
        queryFn: () => api.labels.list(projectId),
        enabled,
        staleTime: 30 * 1000,
    });
}

// Helper for the labels editor components to call after each save so a
// freshly-added value lands in the suggestion dropdown immediately.
export function useInvalidateProjectLabels() {
    const qc = useQueryClient();
    return () => {
        void qc.invalidateQueries({ queryKey: ['labels'] });
    };
}
