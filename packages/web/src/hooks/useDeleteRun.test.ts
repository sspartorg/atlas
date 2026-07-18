import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useDeleteRun } from './useDeleteRun.js';

const BASE = 'http://localhost:3000/api';

describe('useDeleteRun', () => {
    it('deletes a run by id (204) and resolves', async () => {
        server.use(http.delete(`${BASE}/run/r1`, () => new HttpResponse(null, { status: 204 })));
        const { result } = renderHook(() => useDeleteRun('agent-1'), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('r1')).resolves.toBeUndefined();
    });

    it('reports an error when the server fails', async () => {
        server.use(
            http.delete(`${BASE}/run/r2`, () => new HttpResponse('boom', { status: 500 })),
        );
        const { result } = renderHook(() => useDeleteRun('agent-1'), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('r2')).rejects.toBeDefined();
    });
});
