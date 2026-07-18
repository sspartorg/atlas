import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useSearch, useDebouncedValue } from './useSearch.js';

const BASE = 'http://localhost:3000/api';

describe('useSearch', () => {
    it('does not fire a request when query is too short and no filter is set', async () => {
        let calls = 0;
        server.use(
            http.get(`${BASE}/search`, () => {
                calls += 1;
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(() => useSearch({ q: 'a' }), { wrapper: makeWrapper() });
        // give microtasks a chance to flush
        await waitFor(() => expect(result.current.isEnabled).toBe(false));
        expect(calls).toBe(0);
        expect(result.current.data).toEqual([]);
    });

    it('fires a request and returns hits for a 2+ char query', async () => {
        const sample = [
            {
                issue_type: 'story',
                issue_id: 'S-1',
                title: 'foo bar',
                description: '',
                status: 'ready',
                project_id: 'p1',
                assignee_agent_id: null,
                updated_at: '2026-05-15T00:00:00Z',
                rank: 0.5,
            },
        ];
        let captured = '';
        server.use(
            http.get(`${BASE}/search`, ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json(sample);
            }),
        );
        const { result } = renderHook(() => useSearch({ q: 'foo' }), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.data.length).toBe(1));
        expect(captured).toContain('q=foo');
        expect(result.current.data[0]?.title).toBe('foo bar');
    });

    it('forwards filter chips as CSV query params', async () => {
        let captured = '';
        server.use(
            http.get(`${BASE}/search`, ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json([]);
            }),
        );
        renderHook(
            () =>
                useSearch({
                    type: ['story', 'bug'],
                    project_id: ['p1'],
                    status: 'ready',
                    updated: 'last_7_days',
                }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(captured).not.toBe(''));
        expect(captured).toContain('type=story%2Cbug');
        expect(captured).toContain('project_id=p1');
        expect(captured).toContain('status=ready');
        expect(captured).toContain('updated=last_7_days');
    });

    it('fires for a filter-only request (no q)', async () => {
        let calls = 0;
        server.use(
            http.get(`${BASE}/search`, () => {
                calls += 1;
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(() => useSearch({ status: 'ready' }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isEnabled).toBe(true));
        await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    });

    it('passes agent_id filter to query params', async () => {
        let captured = '';
        server.use(
            http.get(`${BASE}/search`, ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json([]);
            }),
        );
        renderHook(() => useSearch({ agent_id: ['agent-1', 'agent-2'] }), { wrapper: makeWrapper() });
        await waitFor(() => expect(captured).not.toBe(''));
        expect(captured).toContain('agent_id=agent-1%2Cagent-2');
    });

    it('passes labels filter to query params', async () => {
        let captured = '';
        server.use(
            http.get(`${BASE}/search`, ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json([]);
            }),
        );
        renderHook(() => useSearch({ labels: ['bug', 'p1'] }), { wrapper: makeWrapper() });
        await waitFor(() => expect(captured).not.toBe(''));
        expect(captured).toContain('labels=bug%2Cp1');
    });

    it('passes limit to query params', async () => {
        let captured = '';
        server.use(
            http.get(`${BASE}/search`, ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json([]);
            }),
        );
        renderHook(() => useSearch({ q: 'foo', limit: 10 }), { wrapper: makeWrapper() });
        await waitFor(() => expect(captured).not.toBe(''));
        expect(captured).toContain('limit=10');
    });

    it('does not fire when type/project_id/agent_id/labels are empty arrays and no query', async () => {
        // Empty arrays are truthy but .length > 0 is false — hits the `&&` false branch
        let calls = 0;
        server.use(
            http.get(`${BASE}/search`, () => {
                calls += 1;
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(
            () => useSearch({ type: [], project_id: [], agent_id: [], labels: [] }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isEnabled).toBe(false));
        expect(calls).toBe(0);
    });
});

describe('useDebouncedValue', () => {
    it('returns the latest value after the delay', async () => {
        const { result, rerender } = renderHook(
            ({ value }: { value: string }) => useDebouncedValue(value, 50),
            { initialProps: { value: 'a' }, wrapper: makeWrapper() },
        );
        expect(result.current).toBe('a');
        rerender({ value: 'b' });
        // initial render still has 'a'
        expect(result.current).toBe('a');
        await act(async () => {
            await new Promise((r) => setTimeout(r, 80));
        });
        expect(result.current).toBe('b');
    });
});
