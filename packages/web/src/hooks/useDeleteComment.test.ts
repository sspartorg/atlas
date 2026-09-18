import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useDeleteComment } from './useDeleteComment.js';

const BASE = 'http://localhost:3000/api';

describe('useDeleteComment', () => {
    it('deletes a task comment (204)', async () => {
        server.use(
            http.delete(`${BASE}/comments/42`, () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteComment('task', 'ATL-1'), {
            wrapper: makeWrapper(),
        });
        await expect(result.current.mutateAsync({ id: 42 })).resolves.toBeUndefined();
    });

    it('deletes a sub_task comment', async () => {
        server.use(
            http.delete(`${BASE}/comments/45`, () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useDeleteComment('sub_task', 'ATL-3'), {
            wrapper: makeWrapper(),
        });
        await expect(result.current.mutateAsync({ id: 45 })).resolves.toBeUndefined();
    });
});
