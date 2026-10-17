import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type { ISubTask, ISubTaskFullResponse } from '@atlas/shared';
import { useToast } from './useToast.js';

// One GET /api/sub-tasks for the link picker's corpus.
export function useAllSubTasks() {
    const q = useQuery<ISubTask[]>({
        queryKey: ['sub-tasks'],
        queryFn: () => api.subTasks.list(),
    });
    return { data: q.data ?? [], isLoading: q.isLoading };
}

// Composite hook backing SubTaskDetail. One HTTP call returns the sub-task
// plus its task, project, related links, activity feed, and the agent
// dictionary.
export function useSubTaskFull(id: string) {
    return useQuery<ISubTaskFullResponse>({
        queryKey: ['sub-tasks', id, 'full'],
        queryFn: () => api.subTasks.full(id),
        enabled: Boolean(id),
        // Detail-page contract — refetch on every mount so back/forward
        // navigation always shows the latest related_links / activity.
        refetchOnMount: 'always',
    });
}

// Sub-task writes change the parent Task's composite (its sub-task list), so
// every mutation here also invalidates the `['tasks']` prefix.
// `deletedId` leaves that sub-task's own queries alone: refetching a row just
// deleted only 404s while its page is still mounted.
function invalidateSubTaskQueries(qc: ReturnType<typeof useQueryClient>, deletedId?: string) {
    void qc.invalidateQueries({ queryKey: ['sub-tasks'], predicate: (q) => q.queryKey[1] !== deletedId });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['issues'] });
    void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
    void qc.invalidateQueries({ queryKey: ['labels'] });
}

export function useCreateSubTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, data }: { taskId: string; data: Partial<ISubTask> }) =>
            api.subTasks.create(taskId, data),
        onSuccess: () => invalidateSubTaskQueries(qc),
    });
}

export function useDeleteSubTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.subTasks.delete(id),
        onSuccess: (_data, id) => invalidateSubTaskQueries(qc, id),
    });
}

// Same contract as the Task hooks: a failure toasts the API's reason.
export function useUpdateSubTask() {
    const qc = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<ISubTask> }) =>
            api.subTasks.update(id, data),
        onSuccess: () => invalidateSubTaskQueries(qc),
        onError: (err, vars) =>
            toast.show({ message: `Couldn't save ${vars.id}`, detail: err.message }),
    });
}

export function useTransitionSubTask() {
    const qc = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, status, override }: { id: string; status: string; override: boolean }) =>
            api.subTasks.transition(id, status, override),
        onSuccess: () => invalidateSubTaskQueries(qc),
        onError: (err, vars) =>
            toast.show({ message: `Couldn't move ${vars.id}`, detail: err.message }),
    });
}

export function useAssignSubTask() {
    const qc = useQueryClient();
    const toast = useToast();
    return useMutation({
        mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
            api.subTasks.assign(id, agentId),
        onSuccess: () => invalidateSubTaskQueries(qc),
        onError: (err, vars) =>
            toast.show({ message: `Couldn't reassign ${vars.id}`, detail: err.message }),
    });
}
