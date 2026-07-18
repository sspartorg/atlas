import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useActiveRuns } from './useActiveRuns.js';

describe('useActiveRuns', () => {
    it('reports hasActiveRuns: false when no runs are active', async () => {
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([
                    { id: 'r1', status: 'completed' },
                    { id: 'r2', status: 'cancelled' },
                ]),
            ),
        );
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(0));
        expect(result.current.hasActiveRuns).toBe(false);
    });

    it('counts queued + in_progress runs as active', async () => {
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([
                    { id: 'r1', status: 'queued' },
                    { id: 'r2', status: 'in_progress' },
                    { id: 'r3', status: 'completed' },
                ]),
            ),
        );
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(2));
        expect(result.current.hasActiveRuns).toBe(true);
    });

    it('treats an empty list as no-active', async () => {
        server.use(http.get('http://localhost:3000/api/run', () => HttpResponse.json([])));
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(0));
        expect(result.current.hasActiveRuns).toBe(false);
    });
});
