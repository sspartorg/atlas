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

    it('names the agents with an active run', async () => {
        server.use(
            http.get('http://localhost:3000/api/run', () =>
                HttpResponse.json([
                    { id: 'r1', agent_id: 'a-coder', status: 'in_progress' },
                    { id: 'r2', agent_id: 'a-coder', status: 'queued' },
                    { id: 'r3', agent_id: 'a-review', status: 'completed' },
                ]),
            ),
        );
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(2));
        expect([...result.current.agentIds]).toEqual(['a-coder']);
    });

    it('treats an empty list as no-active', async () => {
        server.use(http.get('http://localhost:3000/api/run', () => HttpResponse.json([])));
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(0));
        expect(result.current.hasActiveRuns).toBe(false);
    });

    it('asks the API for live runs only, not a page of history', async () => {
        let search = '';
        server.use(
            http.get('http://localhost:3000/api/run', ({ request }) => {
                search = new URL(request.url).search;
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(() => useActiveRuns(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.count).toBe(0));
        expect(new URLSearchParams(search).get('status')).toBe('queued,in_progress');
    });
});
