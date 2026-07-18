import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeComment } from '../test-utils/factories.js';
import { useComments, useCreateComment, useUpdateComment } from './useComments.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useComments', () => {
    it('fetches comments for an issue', async () => {
        server.use(
            http.get('http://localhost:3000/api/comments', ({ request }) => {
                expect(request.url).toContain('issue_type=story');
                expect(request.url).toContain('issue_id=S1');
                return ok([makeComment({ id: 1 })]);
            }),
        );
        const { result } = renderHook(() => useComments('story', 'S1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('stays idle when issueId is empty', () => {
        const { result } = renderHook(() => useComments('story', ''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useCreateComment', () => {
    it('POSTs a new comment', async () => {
        server.use(
            http.post('http://localhost:3000/api/comments', () =>
                ok(makeComment({ id: 99 })),
            ),
        );
        const { result } = renderHook(() => useCreateComment(), { wrapper: makeWrapper() });
        const c = await result.current.mutateAsync({
            author: 'owner',
            issue_type: 'story',
            issue_id: 'S1',
            body: 'hi',
        });
        expect(c.id).toBe(99);
    });

    it('invalidates comment caches for epic issue type', async () => {
        server.use(
            http.post('http://localhost:3000/api/comments', () =>
                ok(makeComment({ id: 100 })),
            ),
        );
        const { result } = renderHook(() => useCreateComment(), { wrapper: makeWrapper() });
        const c = await result.current.mutateAsync({
            author: 'owner',
            issue_type: 'epic',
            issue_id: 'E1',
            body: 'epic comment',
        });
        expect(c.id).toBe(100);
    });

    it('invalidates comment caches for sub_task issue type', async () => {
        server.use(
            http.post('http://localhost:3000/api/comments', () =>
                ok(makeComment({ id: 101 })),
            ),
        );
        const { result } = renderHook(() => useCreateComment(), { wrapper: makeWrapper() });
        const c = await result.current.mutateAsync({
            author: 'agent',
            issue_type: 'sub_task',
            issue_id: 'ST1',
            body: 'sub task comment',
            agent_id: 'agent-1',
        });
        expect(c.id).toBe(101);
    });
});

describe('useUpdateComment', () => {
    it('PATCHes an existing comment body', async () => {
        server.use(
            http.patch('http://localhost:3000/api/comments/5', async ({ request }) => {
                const body = await request.json() as { body: string };
                expect(body.body).toBe('updated text');
                return ok(makeComment({ id: 5 }));
            }),
        );
        const { result } = renderHook(
            () => useUpdateComment('story', 'S1'),
            { wrapper: makeWrapper() },
        );
        const c = await result.current.mutateAsync({ id: 5, body: 'updated text' });
        expect(c.id).toBe(5);
    });

    it('invalidates caches for bug issue type after update', async () => {
        server.use(
            http.patch('http://localhost:3000/api/comments/7', () =>
                ok(makeComment({ id: 7 })),
            ),
        );
        const { result } = renderHook(
            () => useUpdateComment('bug', 'B1'),
            { wrapper: makeWrapper() },
        );
        const c = await result.current.mutateAsync({ id: 7, body: 'fix note' });
        expect(c.id).toBe(7);
    });

    it('invalidates caches for sub_bug issue type after update', async () => {
        server.use(
            http.patch('http://localhost:3000/api/comments/8', () =>
                ok(makeComment({ id: 8 })),
            ),
        );
        const { result } = renderHook(
            () => useUpdateComment('sub_bug', 'SB1'),
            { wrapper: makeWrapper() },
        );
        const c = await result.current.mutateAsync({ id: 8, body: 'sub bug fix' });
        expect(c.id).toBe(8);
    });
});
