import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { ITask, ITaskFullResponse } from '@atlas/shared';
import { useToast } from './useToast.js';
import { reviewedChildrenBlocking, transitionItemOnError } from './useTransitionItem.js';

export function useTasks(projectId?: string, includeArchived = false) {
    return useQuery({
        queryKey: ['tasks', { projectId, includeArchived }],
        queryFn: () => api.tasks.list(projectId, includeArchived),
    });
}

export function useTaskStats() {
    return useQuery({
        queryKey: ['tasks-stats'],
        queryFn: () => api.tasks.stats(),
    });
}

// Composite hook backing TaskDetail. One HTTP call returns the task plus
// project, sub-tasks, related links, activity feed, and the agent
// dictionary. Mutations under `useUpdateTask` / `useTransitionTask` /
// `useAssignTask` invalidate the `['tasks']` prefix, which covers this key.
export function useTaskFull(id: string) {
    return useQuery<ITaskFullResponse>({
        queryKey: ['tasks', id, 'full'],
        queryFn: () => api.tasks.full(id),
        enabled: Boolean(id),
        // Detail-page contract: every navigation INTO the page refetches.
        // The global default's `staleTime: 30_000` would paint the page
        // from a stale cache on quick back/forward — wrong for a detail
        // page because the row is the canonical source of truth for
        // everything below (related links, sub-items, activity).
        refetchOnMount: 'always',
    });
}

export function useCreateTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<ITask>) => api.tasks.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.invalidateQueries({ queryKey: ['tasks-stats'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            // New labels on the freshly created task should show up in the
            // suggestions dropdown on the next edit.
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useUpdateTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<ITask> }) =>
            api.tasks.update(id, data),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.setQueryData(['tasks', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useTransitionTask() {
    const qc = useQueryClient();
    const toast = useToast();
    const mutation = useMutation({
        mutationFn: ({
            id,
            status,
            override,
            closeSubTasks,
        }: {
            id: string;
            status: string;
            override?: boolean;
            closeSubTasks?: boolean;
        }) => api.tasks.transition(id, status, override ?? false, closeSubTasks ?? false),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            void qc.invalidateQueries({ queryKey: ['tasks-stats'] });
            void qc.setQueryData(['tasks', updated.id], updated);
        },
        onError: (err, vars) => {
            // Closing a verified Task: when only reviewed sub-tasks block it,
            // offer to close them with it instead of a dead end.
            const reviewed = reviewedChildrenBlocking(err);
            if (vars.status === 'done' && !vars.closeSubTasks && reviewed > 0) {
                toast.show({
                    message: `${reviewed} sub-task${reviewed === 1 ? ' is' : 's are'} in review`,
                    detail: 'Close them with the Task?',
                    action: { label: 'Close them too', onClick: () => mutation.mutate({ ...vars, closeSubTasks: true }) },
                });
                return;
            }
            // P16 — surface closure-rule 422 in a toast listing open sub-tasks.
            transitionItemOnError(toast, err);
        },
    });
    return mutation;
}

export function useReorderSubTasks() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, ids }: { taskId: string; ids: string[] }) => api.tasks.reorderSubTasks(taskId, ids),
        onSuccess: (_res, { taskId }) => {
            void qc.invalidateQueries({ queryKey: ['tasks', taskId] });
            void qc.invalidateQueries({ queryKey: ['sub-tasks'] });
        },
    });
}

export function useAssignTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
            api.tasks.assign(id, agentId),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.setQueryData(['tasks', updated.id], updated);
        },
    });
}

export function useDeleteTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.tasks.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.invalidateQueries({ queryKey: ['tasks-stats'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
        },
    });
}
