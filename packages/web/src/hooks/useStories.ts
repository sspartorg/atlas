import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/api.js';
import type {
    IStory,
    IStoryFullResponse,
    ISubTaskFullResponse,
    ISubBugFullResponse,
} from '@atlas/shared';
import { useToast } from './useToast.js';
import { transitionItemOnError } from './useTransitionItem.js';

export function useStories(
    opts: { epicId?: string | undefined; projectId?: string | undefined } = {}
) {
    const { epicId, projectId } = opts;
    return useQuery({
        queryKey: ['stories', { epicId, projectId }],
        queryFn: () => api.stories.list({ epicId, projectId }),
    });
}

export function useStory(id: string) {
    return useQuery({
        queryKey: ['stories', id],
        queryFn: () => api.stories.get(id),
        enabled: Boolean(id),
    });
}

// Composite hook backing StoryDetail. One HTTP call returns the story plus
// ancestors (epic, project), children (sub-tasks, sub-bugs), related links,
// activity feed, and the agent dictionary — everything the page renders.
// Mutations under `useTransitionStory` / `useAssignStory` / `useUpdateStory`
// already invalidate the `['stories']` prefix, which covers this key.
export function useStoryFull(id: string) {
    return useQuery<IStoryFullResponse>({
        queryKey: ['stories', id, 'full'],
        queryFn: () => api.stories.full(id),
        enabled: Boolean(id),
        // Detail-page contract — refetch on every mount so back/forward
        // navigation always shows the latest related_links / sub-items /
        // activity. Global default staleTime would paint from cache.
        refetchOnMount: 'always',
    });
}

export function useCreateStory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<IStory>) => api.stories.create(data),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useTransitionStory() {
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
        }) => api.stories.transition(id, status, override ?? false),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.setQueryData(['stories', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
        // P16 — surface the closure-rule 422 as a toast listing the open
        // children. Other errors fall through to the caller's onError.
        onError: (err) => {
            transitionItemOnError(toast, err);
        },
    });
}

export function useAssignStory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
            api.stories.assign(id, agentId),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.setQueryData(['stories', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}

// A04 — Owner-initiated reset-rounds escape hatch from the Rounds row
// on `DetailsRailCard`. Backed by `POST /api/stories/:id/reset-rounds`;
// returns 204 and emits a `rounds_reset` activity event server-side.
// Invalidates the story-full query so the rail and the activity log
// both repaint.
export function useResetRoundsStory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: string }) => api.stories.resetRounds(id),
        onSuccess: (_void, { id }) => {
            void qc.invalidateQueries({ queryKey: ['stories', id, 'full'] });
        },
    });
}

export function useUpdateStory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<IStory> }) =>
            api.stories.update(id, data),
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.setQueryData(['stories', updated.id], updated);
            void qc.invalidateQueries({ queryKey: ['issues'] });
            void qc.invalidateQueries({ queryKey: ['labels'] });
        },
    });
}

export function useDeleteStory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.stories.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}

export function useDeleteSubTask() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.subTasks.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['sub-tasks'] });
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}

export function useDeleteSubBug() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.subBugs.delete(id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['sub-bugs'] });
            void qc.invalidateQueries({ queryKey: ['stories'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            void qc.invalidateQueries({ queryKey: ['issues'] });
        },
    });
}

export function useSubTasks(storyId: string) {
    return useQuery({
        queryKey: ['stories', storyId, 'sub-tasks'],
        queryFn: () => api.stories.getSubTasks(storyId),
        enabled: Boolean(storyId),
    });
}

export function useSubBugs(storyId: string) {
    return useQuery({
        queryKey: ['stories', storyId, 'sub-bugs'],
        queryFn: () => api.stories.getSubBugs(storyId),
        enabled: Boolean(storyId),
    });
}

// Composite hook backing SubTaskDetail. One HTTP call returns the sub-task
// plus ancestors (parent_story, epic, project), related links, activity
// feed, and the agent dictionary. Existing mutation handlers in
// SubTaskDetail invalidate the `['sub-tasks']` prefix, which covers this
// key.
export function useSubTaskFull(id: string) {
    return useQuery<ISubTaskFullResponse>({
        queryKey: ['sub-tasks', id, 'full'],
        queryFn: () => api.subTasks.full(id),
        enabled: Boolean(id),
        refetchOnMount: 'always',
    });
}

// Composite hook backing SubBugDetail. One HTTP call returns the sub-bug
// plus ancestors (parent_story, epic, project), related links, activity
// feed, and the agent dictionary. Existing mutation handlers in
// SubBugDetail invalidate the `['sub-bugs']` prefix, which covers this key.
export function useSubBugFull(id: string) {
    return useQuery<ISubBugFullResponse>({
        queryKey: ['sub-bugs', id, 'full'],
        queryFn: () => api.subBugs.full(id),
        enabled: Boolean(id),
        refetchOnMount: 'always',
    });
}
