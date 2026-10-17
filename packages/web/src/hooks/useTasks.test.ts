import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeTask, makeTaskListItem } from '../test-utils/factories.js';
import {
    useAssignTask,
    useCreateTask,
    useDeleteTask,
    useTaskFull,
    useTasks,
    useTransitionTask,
    useUpdateTask,
} from './useTasks.js';
import { useToast } from './useToast.js';

const ok = (body: JsonBodyType) => HttpResponse.json(body);

describe('useTasks', () => {
    it('lists tasks', async () => {
        server.use(handlers.listTasks([makeTaskListItem({ id: 'E1' })]));
        const { result } = renderHook(() => useTasks(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('accepts a project filter', async () => {
        server.use(handlers.listTasks([]));
        const { result } = renderHook(() => useTasks('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('accepts includeArchived=true', async () => {
        server.use(handlers.listTasks([makeTaskListItem({ id: 'E2' })]));
        const { result } = renderHook(() => useTasks('p1', true), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useTaskFull', () => {
    it('fetches the full composite payload', async () => {
        server.use(
            http.get('http://localhost:3000/api/tasks/E1/full', () =>
                ok({ task: makeTask({ id: 'E1' }), sub_tasks: [] }),
            ),
        );
        const { result } = renderHook(() => useTaskFull('E1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('stays idle when id is empty', () => {
        const { result } = renderHook(() => useTaskFull(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateTask + useUpdateTask + useDeleteTask', () => {
    it('create posts a task', async () => {
        server.use(
            http.post('http://localhost:3000/api/tasks', () => ok(makeTask({ id: 'E9' }))),
        );
        const { result } = renderHook(() => useCreateTask(), { wrapper: makeWrapper() });
        const created = await result.current.mutateAsync({ title: 'New Task' });
        expect(created.id).toBe('E9');
    });

    it('update patches a task', async () => {
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1', () =>
                ok(makeTask({ id: 'E1', title: 'Renamed' })),
            ),
        );
        const { result } = renderHook(() => useUpdateTask(), { wrapper: makeWrapper() });
        const updated = await result.current.mutateAsync({ id: 'E1', data: { title: 'Renamed' } });
        expect(updated.title).toBe('Renamed');
    });

    it('delete resolves on 204', async () => {
        server.use(
            http.delete('http://localhost:3000/api/tasks/E1', () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteTask(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('E1')).resolves.toBeUndefined();
    });
});

describe('useTransitionTask + useAssignTask', () => {
    it('transition onError fires on 422', async () => {
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/status', () =>
                HttpResponse.json({ message: 'open children' }, { status: 422 }),
            ),
        );
        const { result } = renderHook(() => useTransitionTask(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'E1', status: 'done' })).rejects.toBeDefined();
    });

    it('offers to close reviewed sub-tasks with the Task, and resends with close_sub_tasks', async () => {
        const bodies: unknown[] = [];
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/status', async ({ request }) => {
                const body = (await request.json()) as { close_sub_tasks?: boolean };
                bodies.push(body);
                return body.close_sub_tasks
                    ? ok(makeTask({ id: 'E1', status: 'done' }))
                    : HttpResponse.json(
                          { error: 'open children', kind: 'conflict', details: { parent_id: 'E1', open_children: [{ id: 'E2', status: 'in_review' }] } },
                          { status: 422 },
                      );
            }),
        );
        const { result } = renderHook(() => ({ transition: useTransitionTask(), toast: useToast() }), { wrapper: makeWrapper() });
        result.current.transition.mutate({ id: 'E1', status: 'done' });
        await waitFor(() => expect(result.current.toast.toasts[0]?.action?.label).toBe('Close them too'));
        expect(result.current.toast.toasts[0]?.message).toBe('1 sub-task is in review');
        act(() => result.current.toast.toasts[0]?.action?.onClick());
        await waitFor(() => expect(bodies).toEqual([{ status: 'done' }, { status: 'done', close_sub_tasks: true }]));
    });

    it('transition issues a patch', async () => {
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/status', () =>
                ok(makeTask({ id: 'E1', status: 'in_progress' })),
            ),
        );
        const { result } = renderHook(() => useTransitionTask(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'E1', status: 'in_progress', override: true });
        expect(r.status).toBe('in_progress');
    });

    it('assign issues a patch', async () => {
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/assign', () =>
                ok(makeTask({ id: 'E1', assignee_agent_id: 'agent-coder' })),
            ),
        );
        const { result } = renderHook(() => useAssignTask(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'E1', agentId: 'agent-coder' });
        expect(r.assignee_agent_id).toBe('agent-coder');
    });

    it('every failed Task mutation toasts the API reason', async () => {
        const lock = { error: 'A workflow run is working on this item and owns its status and assignee. Stop the run to change them by hand.' };
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/status', () => HttpResponse.json(lock, { status: 409 })),
            http.patch('http://localhost:3000/api/tasks/E1/assign', () => HttpResponse.json(lock, { status: 409 })),
            http.patch('http://localhost:3000/api/tasks/E1', () => HttpResponse.json({ error: 'Title too long' }, { status: 400 })),
        );
        const { result } = renderHook(
            () => ({ transition: useTransitionTask(), assign: useAssignTask(), update: useUpdateTask(), toast: useToast() }),
            { wrapper: makeWrapper() },
        );
        result.current.transition.mutate({ id: 'E1', status: 'ready' });
        result.current.assign.mutate({ id: 'E1', agentId: null });
        result.current.update.mutate({ id: 'E1', data: { title: 'x' } });
        await waitFor(() => expect(result.current.toast.toasts).toHaveLength(3));
        expect(result.current.toast.toasts.map((t) => [t.message, t.detail])).toEqual(
            expect.arrayContaining([
                ["Couldn't move E1", lock.error],
                ["Couldn't reassign E1", lock.error],
                ["Couldn't save E1", 'Title too long'],
            ]),
        );
    });

    it('a closure refusal shows one toast, not a second generic one', async () => {
        server.use(
            http.patch('http://localhost:3000/api/tasks/E1/status', () =>
                HttpResponse.json(
                    { error: 'Cannot close E1', kind: 'conflict', details: { parent_id: 'E1', open_children: [{ id: 'E2', status: 'in_progress' }] } },
                    { status: 422 },
                ),
            ),
        );
        const { result } = renderHook(() => ({ transition: useTransitionTask(), toast: useToast() }), { wrapper: makeWrapper() });
        result.current.transition.mutate({ id: 'E1', status: 'done' });
        await waitFor(() => expect(result.current.toast.toasts).toHaveLength(1));
        expect(result.current.toast.toasts[0]?.message).toBe('Cannot close — open children');
    });
});

describe('useDeleteTask', () => {
    it('does not refetch the deleted Task while its page is still mounted', async () => {
        let fullGets = 0;
        server.use(
            http.get('http://localhost:3000/api/tasks/ATL-9/full', () => {
                fullGets += 1;
                return HttpResponse.json({ task: { id: 'ATL-9' } });
            }),
            http.delete('http://localhost:3000/api/tasks/ATL-9', () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => ({ full: useTaskFull('ATL-9'), del: useDeleteTask() }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.full.isSuccess).toBe(true));
        await result.current.del.mutateAsync('ATL-9');
        await new Promise((r) => setTimeout(r, 50));
        expect(fullGets).toBe(1);
    });
});

