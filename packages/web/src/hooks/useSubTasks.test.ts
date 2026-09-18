import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeSubTask } from '../test-utils/factories.js';
import {
    useAllSubTasks,
    useCreateSubTask,
    useDeleteSubTask,
    useSubTaskFull,
} from './useSubTasks.js';

describe('useAllSubTasks', () => {
    it('starts loading, then passes the list through', async () => {
        server.use(handlers.listSubTasks([makeSubTask({ id: 'ST-1' })]));
        const { result } = renderHook(() => useAllSubTasks(), { wrapper: makeWrapper() });
        expect(result.current.isLoading).toBe(true);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data.map((s) => s.id)).toEqual(['ST-1']);
    });
});

describe('useSubTaskFull', () => {
    it('fetches the composite payload', async () => {
        server.use(
            http.get('http://localhost:3000/api/sub-tasks/ST-1/full', () =>
                HttpResponse.json({ sub_task: makeSubTask({ id: 'ST-1' }), task: null }),
            ),
        );
        const { result } = renderHook(() => useSubTaskFull('ST-1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.sub_task.id).toBe('ST-1');
    });

    it('stays idle on empty id', () => {
        const { result } = renderHook(() => useSubTaskFull(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateSubTask', () => {
    it('posts under the parent task with task_id in the body', async () => {
        let body: unknown;
        server.use(
            http.post('http://localhost:3000/api/tasks/ATL-1/sub-tasks', async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(makeSubTask({ id: 'ST-9' }));
            }),
        );
        const { result } = renderHook(() => useCreateSubTask(), { wrapper: makeWrapper() });
        await result.current.mutateAsync({
            taskId: 'ATL-1',
            data: { title: 'Write tests', labels: ['qa'] },
        });
        expect(body).toEqual({ title: 'Write tests', labels: ['qa'], task_id: 'ATL-1' });
    });
});

describe('useDeleteSubTask', () => {
    it('resolves on 204', async () => {
        server.use(
            http.delete(
                'http://localhost:3000/api/sub-tasks/ST-1',
                () => new HttpResponse(null, { status: 204 }),
            ),
        );
        const { result } = renderHook(() => useDeleteSubTask(), { wrapper: makeWrapper() });
        await result.current.mutateAsync('ST-1');
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});
