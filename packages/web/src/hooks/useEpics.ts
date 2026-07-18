import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IEpic, IEpicFullResponse } from '@atlas/shared';
import { useToast } from './useToast.js';
import { transitionItemOnError } from './useTransitionItem.js';

export function useEpics(projectId?: string, includeArchived = false) {
    return useQuery({
        queryKey: ['epics', { projectId, includeArchived }],
        queryFn: () => api.epics.list(projectId, includeArchived),
    });
}

export function useEpicStats() {
    return useQuery({
        queryKey: ['epics-stats'],
        queryFn: () => api.epics.stats(),
    });
}

export function useEpic(id: string) {
    return useQuery({
        queryKey: ['epics', id],
        queryFn: () => api.epics.get(id),
        enabled: Boolean(id),
    });
}

// Composite hook backing EpicDetail. One HTTP call returns the epic plus
// project, child stories, child bugs, related links, activity feed, and
// the agent dictionary. Mutations under `useUpdateEpic` /
// `useTransitionEpic` / `useAssignEpic` invalidate the `['epics']` prefix,
// which covers this key.
export function useEpicFull(id: string) {
    return useQuery<IEpicFullResponse>({
        queryKey: ['epics', id, 'full'],
        queryFn: () => api.epics.full(id),
        enabled: Boolean(id),
        // Detail-page contract: every navigation INTO the page refetches.
        // The global default's `staleTime: 30_000` would paint the page
        // from a stale cache on quick back/forward — wrong for a detail
        // page because the row is the canonical source of truth for
        // everything below (related links, sub-items, activity).
        refetchOnMount: 'always',
    });
}

export function useCreateEpic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<IEpic>) => api.epics.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['epics-stats'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            // Task 1 — new labels on the freshly created epic should
            // show up in the suggestions dropdown on the next edit.
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useUpdateEpic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<IEpic> }) =>
            api.epics.update(id, data),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.setQueryData(['epics', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useTransitionEpic() {
    const qc = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({
            id,
            status,
            override,
        }: {
            id: string;
            status: string;
            override?: boolean;
        }) => api.epics.transition(id, status, override ?? false),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['epics-stats'] });
            void qc.setQueryData(['epics', updated.id], updated);
        },
        // P16 — surface closure-rule 422 in a toast listing open children.
        onError: (err) => {
            transitionItemOnError(toast, err);
        },
    });
}

export function useAssignEpic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
            api.epics.assign(id, agentId),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.setQueryData(['epics', updated.id], updated);
        },
    });
}

// A04 — Owner-initiated reset-rounds escape hatch. See
// useResetRoundsStory for the full rationale; same shape per kind.
export function useResetRoundsEpic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: string }) => api.epics.resetRounds(id),
        onSuccess: (_void, { id }) => {
            void qc.invalidateQueries({ queryKey: ['epics', id, 'full'] });
        },
    });
}

export function useDeleteEpic() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.epics.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['epics-stats'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
        },
    });
}
