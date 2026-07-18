import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeBug } from '../test-utils/factories.js';
import {
    useAssignBug,
    useBug,
    useBugFull,
    useBugs,
    useCreateBug,
    useDeleteBug,
    useResetRoundsBug,
    useTransitionBug,
    useUpdateBug,
} from './useBugs.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useBugs', () => {
    it('lists bugs', async () => {
        server.use(handlers.listBugs([makeBug({ id: 'B1' })]));
        const { result } = renderHook(() => useBugs(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('accepts filter opts', async () => {
        server.use(handlers.listBugs([]));
        const { result } = renderHook(() => useBugs({ epicId: 'E1' }), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useBug + useBugFull', () => {
    it('fetches by id', async () => {
        server.use(http.get('http://localhost:3000/api/bugs/B1', () => ok(makeBug({ id: 'B1' }))));
        const { result } = renderHook(() => useBug('B1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('fetches the composite', async () => {
        server.use(http.get('http://localhost:3000/api/bugs/B1/full', () => ok({})));
        const { result } = renderHook(() => useBugFull('B1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('idle when id empty', () => {
        const { result } = renderHook(() => useBug(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useResetRoundsBug', () => {
    it('resets rounds and invalidates the full query', async () => {
        server.use(
            http.post('http://localhost:3000/api/bugs/B1/reset-rounds', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const { result } = renderHook(() => useResetRoundsBug(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'B1' })).resolves.toBeUndefined();
    });
});

describe('bug mutations', () => {
    it('create/update/transition/assign/delete', async () => {
        server.use(
            http.post('http://localhost:3000/api/bugs', () => ok(makeBug({ id: 'B9' }))),
            http.patch('http://localhost:3000/api/bugs/B1', () => ok(makeBug({ id: 'B1' }))),
            http.patch('http://localhost:3000/api/bugs/B1/status', () => ok(makeBug({ id: 'B1' }))),
            http.patch('http://localhost:3000/api/bugs/B1/assign', () => ok(makeBug({ id: 'B1' }))),
            http.delete('http://localhost:3000/api/bugs/B1', () => new HttpResponse(null, { status: 204 })),
        );
        const create = renderHook(() => useCreateBug(), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({ title: 'b' });
        expect(c.id).toBe('B9');
        const update = renderHook(() => useUpdateBug(), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 'B1', data: {} });
        const transition = renderHook(() => useTransitionBug(), { wrapper: makeWrapper() });
        await transition.result.current.mutateAsync({ id: 'B1', status: 'ready' });
        const assign = renderHook(() => useAssignBug(), { wrapper: makeWrapper() });
        await assign.result.current.mutateAsync({ id: 'B1', agentId: null });
        const del = renderHook(() => useDeleteBug(), { wrapper: makeWrapper() });
        await expect(del.result.current.mutateAsync('B1')).resolves.toBeUndefined();
    });

    it('transition onError path fires when server returns 422', async () => {
        server.use(
            http.patch('http://localhost:3000/api/bugs/B1/status', () =>
                HttpResponse.json({ message: 'open children: S1' }, { status: 422 }),
            ),
        );
        const { result } = renderHook(() => useTransitionBug(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync({ id: 'B1', status: 'done' })).rejects.toBeDefined();
    });
});
