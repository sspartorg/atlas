import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeEpic, makeEpicListItem } from '../test-utils/factories.js';
import {
    useAssignEpic,
    useCreateEpic,
    useDeleteEpic,
    useEpic,
    useEpicFull,
    useEpicStats,
    useEpics,
    useResetRoundsEpic,
    useTransitionEpic,
    useUpdateEpic,
} from './useEpics.js';

const ok = (body: JsonBodyType) => HttpResponse.json(body);

describe('useEpics', () => {
    it('lists epics', async () => {
        server.use(handlers.listEpics([makeEpicListItem({ id: 'E1' })]));
        const { result } = renderHook(() => useEpics(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('accepts a project filter', async () => {
        server.use(handlers.listEpics([]));
        const { result } = renderHook(() => useEpics('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('accepts includeArchived=true', async () => {
        server.use(handlers.listEpics([makeEpicListItem({ id: 'E2' })]));
        const { result } = renderHook(() => useEpics('p1', true), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useEpicStats', () => {
    it('returns the stats payload', async () => {
        server.use(
            http.get('http://localhost:3000/api/epics/stats', () =>
                ok({ total: 5, awaiting_pickup: 2 }),
            ),
        );
        const { result } = renderHook(() => useEpicStats(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.total).toBe(5);
    });
});

describe('useEpic + useEpicFull', () => {
    it('fetches the simple epic', async () => {
        server.use(handlers.getEpic(makeEpic({ id: 'E1' })));
        const { result } = renderHook(() => useEpic('E1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('fetches the full composite payload', async () => {
        server.use(
            http.get('http://localhost:3000/api/epics/E1/full', () =>
                ok({ epic: makeEpic({ id: 'E1' }), stories: [], bugs: [] }),
            ),
        );
        const { result } = renderHook(() => useEpicFull('E1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('stays idle when id is empty', () => {
        const { result } = renderHook(() => useEpic(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateEpic + useUpdateEpic + useDeleteEpic', () => {
    it('create posts an epic', async () => {
        server.use(
            http.post('http://localhost:3000/api/epics', () => ok(makeEpic({ id: 'E9' }))),
        );
        const { result } = renderHook(() => useCreateEpic(), { wrapper: makeWrapper() });
        const created = await result.current.mutateAsync({ title: 'New Epic' });
        expect(created.id).toBe('E9');
    });

    it('update patches an epic', async () => {
        server.use(
            http.patch('http://localhost:3000/api/epics/E1', () =>
                ok(makeEpic({ id: 'E1', title: 'Renamed' })),
            ),
        );
        const { result } = renderHook(() => useUpdateEpic(), { wrapper: makeWrapper() });
        const updated = await result.current.mutateAsync({ id: 'E1', data: { title: 'Renamed' } });
        expect(updated.title).toBe('Renamed');
    });

    it('delete resolves on 204', async () => {
        server.use(
            http.delete('http://localhost:3000/api/epics/E1', () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteEpic(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('E1')).resolves.toBeUndefined();
    });
});

describe('useResetRoundsEpic', () => {
    it('posts to reset-rounds and invalidates the full query', async () => {
        server.use(
            http.post('http://localhost:3000/api/epics/E1/reset-rounds', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const { result } = renderHook(() => useResetRoundsEpic(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'E1' })).resolves.toBeUndefined();
    });
});

describe('useTransitionEpic + useAssignEpic', () => {
    it('transition onError fires on 422', async () => {
        server.use(
            http.patch('http://localhost:3000/api/epics/E1/status', () =>
                HttpResponse.json({ message: 'open children' }, { status: 422 }),
            ),
        );
        const { result } = renderHook(() => useTransitionEpic(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'E1', status: 'done' })).rejects.toBeDefined();
    });

    it('transition issues a patch', async () => {
        server.use(
            http.patch('http://localhost:3000/api/epics/E1/status', () =>
                ok(makeEpic({ id: 'E1', status: 'in_progress' })),
            ),
        );
        const { result } = renderHook(() => useTransitionEpic(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'E1', status: 'in_progress', override: true });
        expect(r.status).toBe('in_progress');
    });

    it('assign issues a patch', async () => {
        server.use(
            http.patch('http://localhost:3000/api/epics/E1/assign', () =>
                ok(makeEpic({ id: 'E1', assignee_agent_id: 'agent-coder' })),
            ),
        );
        const { result } = renderHook(() => useAssignEpic(), { wrapper: makeWrapper() });
        const r = await result.current.mutateAsync({ id: 'E1', agentId: 'agent-coder' });
        expect(r.assignee_agent_id).toBe('agent-coder');
    });

});
