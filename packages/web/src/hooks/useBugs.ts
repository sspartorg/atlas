import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { IBug, IBugFullResponse } from '@atlas/shared';
import { useToast } from './useToast.js';
import { transitionItemOnError } from './useTransitionItem.js';

export function useBugs(
    opts: { epicId?: string | undefined; projectId?: string | undefined } = {}
) {
    const { epicId, projectId } = opts;
    return useQuery({
        queryKey: ['bugs', { epicId, projectId }],
        queryFn: () => api.bugs.list({ epicId, projectId }),
    });
}

export function useBug(id: string) {
    return useQuery({
        queryKey: ['bugs', id],
        queryFn: () => api.bugs.get(id),
        enabled: Boolean(id),
    });
}

// Composite hook backing BugDetail. One HTTP call returns the bug plus
// ancestors (epic, project), related links, activity feed, and the agent
// dictionary. Mutations under `useUpdateBug` / `useTransitionBug` /
// `useAssignBug` / `useSetBugPlan` invalidate the `['bugs']` prefix, which
// covers this key.
export function useBugFull(id: string) {
    return useQuery<IBugFullResponse>({
        queryKey: ['bugs', id, 'full'],
        queryFn: () => api.bugs.full(id),
        enabled: Boolean(id),
        // Detail-page contract — refetch on every mount. See
        // useEpics.useEpicFull for full rationale.
        refetchOnMount: 'always',
    });
}

export function useCreateBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<IBug>) => api.bugs.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useUpdateBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<IBug> }) =>
            api.bugs.update(id, data),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.setQueryData(['bugs', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['issues'] });
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useTransitionBug() {
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
        }) => api.bugs.transition(id, status, override ?? false),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.setQueryData(['bugs', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
        // P16 — surface closure-rule 422 in a toast listing open children.
        onError: (err) => {
            transitionItemOnError(toast, err);
        },
    });
}

export function useAssignBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
            api.bugs.assign(id, agentId),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.setQueryData(['bugs', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}

// A04 — Owner-initiated reset-rounds escape hatch. See
// useResetRoundsStory for the full rationale; same shape per kind.
export function useResetRoundsBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: string }) => api.bugs.resetRounds(id),
        onSuccess: (_void, { id }) => {
            void qc.invalidateQueries({ queryKey: ['bugs', id, 'full'] });
        },
    });
}

export function useDeleteBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.bugs.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['bugs'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}
