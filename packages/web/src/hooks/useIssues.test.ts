import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { flattenIssueTree, makeShortId, useIssues } from './useIssues.js';

describe('useIssues', () => {
    it('fetches the tree without project filter', async () => {
        server.use(
            http.get('http://localhost:3000/api/issues/tree', ({ request }) => {
                expect(request.url).not.toContain('project_id');
                return HttpResponse.json({ tree: [], projects: [], agents: [], tasks: [] });
            }),
        );
        const { result } = renderHook(() => useIssues(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('passes the project filter', async () => {
        server.use(
            http.get('http://localhost:3000/api/issues/tree', ({ request }) => {
                expect(request.url).toContain('project_id=p1');
                return HttpResponse.json({ tree: [], projects: [], agents: [], tasks: [] });
            }),
        );
        const { result } = renderHook(() => useIssues({ projectId: 'p1' }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('passes includeArchived=true as a query param', async () => {
        let captured = '';
        server.use(
            http.get('http://localhost:3000/api/issues/tree', ({ request }) => {
                captured = new URL(request.url).search;
                return HttpResponse.json({ tree: [], projects: [], agents: [], tasks: [] });
            }),
        );
        const { result } = renderHook(() => useIssues({ includeArchived: true }), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(captured).toContain('include_archived=true');
    });
});

describe('flattenIssueTree', () => {
    it('flattens parents then children inline', () => {
        const tree = [
            {
                id: 'T1',
                kind: 'task',
                title: 'T1',
                status: 'ready',
                children: [
                    { id: 'ST1', kind: 'sub_task', task_id: 'T1', title: '', status: '', children: [] },
                ],
            } as unknown as Parameters<typeof flattenIssueTree>[0][number],
        ];
        const out = flattenIssueTree(tree);
        expect(out.map((n) => n.id)).toEqual(['T1', 'ST1']);
    });
});

describe('makeShortId', () => {
    it('returns the id unchanged', () => {
        expect(makeShortId('task', 'ATL-5')).toBe('ATL-5');
    });
});
