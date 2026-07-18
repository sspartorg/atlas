import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeStory, makeSubBug, makeSubTask } from '../test-utils/factories.js';
import {
    useAssignStory,
    useCreateStory,
    useDeleteStory,
    useDeleteSubBug,
    useDeleteSubTask,
    useResetRoundsStory,
    useStories,
    useStory,
    useStoryFull,
    useSubBugFull,
    useSubBugs,
    useSubTaskFull,
    useSubTasks,
    useTransitionStory,
    useUpdateStory,
} from './useStories.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useStories', () => {
    it('list with no opts', async () => {
        server.use(handlers.listStories([makeStory({ id: 'S1' })]));
        const { result } = renderHook(() => useStories(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('list with filter opts', async () => {
        server.use(handlers.listStories([]));
        const { result } = renderHook(() => useStories({ epicId: 'E1', projectId: 'p1' }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useStory + useStoryFull', () => {
    it('fetches a single story', async () => {
        server.use(handlers.getStory(makeStory({ id: 'S1' })));
        const { result } = renderHook(() => useStory('S1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('fetches the composite payload', async () => {
        server.use(http.get('http://localhost:3000/api/stories/S1/full', () => ok({})));
        const { result } = renderHook(() => useStoryFull('S1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('stays idle on empty id', () => {
        const { result } = renderHook(() => useStory(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('mutations', () => {
    it('create posts', async () => {
        server.use(http.post('http://localhost:3000/api/stories', () => ok(makeStory({ id: 'S9' }))));
        const { result } = renderHook(() => useCreateStory(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ title: 'X' });
        expect(r.id).toBe('S9');
    });

    it('update patches by id', async () => {
        server.use(
            http.patch('http://localhost:3000/api/stories/S1', () =>
                ok(makeStory({ id: 'S1', title: 'r' })),
            ),
        );
        const { result } = renderHook(() => useUpdateStory(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'S1', data: { title: 'r' } });
        expect(r.title).toBe('r');
    });

    it('transition routes', async () => {
        server.use(
            http.patch('http://localhost:3000/api/stories/S1/status', () =>
                ok(makeStory({ id: 'S1', status: 'in_progress' })),
            ),
        );
        const { result } = renderHook(() => useTransitionStory(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'S1', status: 'in_progress' });
        expect(r.status).toBe('in_progress');
    });

    it('assign', async () => {
        server.use(
            http.patch('http://localhost:3000/api/stories/S1/assign', () =>
                ok(makeStory({ id: 'S1' })),
            ),
        );
        const { result } = renderHook(() => useAssignStory(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'S1', agentId: null });
        expect(r.id).toBe('S1');
    });

    it('delete', async () => {
        server.use(
            http.delete('http://localhost:3000/api/stories/S1', () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteStory(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('S1')).resolves.toBeUndefined();
    });
});

describe('useResetRoundsStory', () => {
    it('posts to reset-rounds and invalidates the full query', async () => {
        server.use(
            http.post('http://localhost:3000/api/stories/S1/reset-rounds', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const { result } = renderHook(() => useResetRoundsStory(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'S1' })).resolves.toBeUndefined();
    });
});

describe('useTransitionStory onError', () => {
    it('fires the onError callback when server returns 422', async () => {
        server.use(
            http.patch('http://localhost:3000/api/stories/S1/status', () =>
                HttpResponse.json({ message: 'open children: T1' }, { status: 422 }),
            ),
        );
        const { result } = renderHook(() => useTransitionStory(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'S1', status: 'done' })).rejects.toBeDefined();
    });
});

describe('sub-task/sub-bug hooks', () => {
    it('useSubTasks', async () => {
        server.use(
            http.get('http://localhost:3000/api/stories/S1/sub-tasks', () => ok([makeSubTask({ id: 'T1' })])),
        );
        const { result } = renderHook(() => useSubTasks('S1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('useSubBugs', async () => {
        server.use(
            http.get('http://localhost:3000/api/stories/S1/sub-bugs', () => ok([makeSubBug({ id: 'SB1' })])),
        );
        const { result } = renderHook(() => useSubBugs('S1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useSubTaskFull', async () => {
        server.use(http.get('http://localhost:3000/api/sub-tasks/T1/full', () => ok({})));
        const { result } = renderHook(() => useSubTaskFull('T1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useSubBugFull', async () => {
        server.use(http.get('http://localhost:3000/api/sub-bugs/SB1/full', () => ok({})));
        const { result } = renderHook(() => useSubBugFull('SB1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useDeleteSubTask + useDeleteSubBug', async () => {
        server.use(
            http.delete('http://localhost:3000/api/sub-tasks/T1', () => new HttpResponse(null, { status: 204 })),
            http.delete('http://localhost:3000/api/sub-bugs/SB1', () => new HttpResponse(null, { status: 204 })),
        );
        const { result: r1 } = renderHook(() => useDeleteSubTask(), { wrapper: makeWrapper() });
        await expect(r1.current.mutateAsync('T1')).resolves.toBeUndefined();
        const { result: r2 } = renderHook(() => useDeleteSubBug(), { wrapper: makeWrapper() });
        await expect(r2.current.mutateAsync('SB1')).resolves.toBeUndefined();
    });
});
