import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCreateIssueExternalLink,
    useDeleteIssueExternalLink,
    useIssueExternalLinks,
} from './useIssueExternalLinks.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useIssueExternalLinks', () => {
    it('fetches external links for an item', async () => {
        server.use(
            http.get('http://localhost:3000/api/issues/story/S1/external-links', () => ok([])),
        );
        const { result } = renderHook(() => useIssueExternalLinks('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('is idle when disabled', () => {
        const { result } = renderHook(
            () => useIssueExternalLinks('story', 'S1', { enabled: false }),
            { wrapper: makeWrapper() },
        );
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('create + delete mutations succeed against the right routes', async () => {
        let createBody: { link_kind?: string; url?: string; title?: string | null } = {};
        server.use(
            http.post(
                'http://localhost:3000/api/issues/story/S1/external-links',
                async ({ request }) => {
                    createBody = (await request.json()) as typeof createBody;
                    return ok({
                        id: 7,
                        item_id: 'S1',
                        link_kind: createBody.link_kind ?? 'pull_request',
                        url: createBody.url ?? '',
                        title: createBody.title ?? null,
                        external_ref: '42',
                        created_at: '2026-06-30T00:00:00Z',
                        created_by_run_id: null,
                    });
                },
            ),
            http.delete(
                'http://localhost:3000/api/issues/external-links/7',
                () => new HttpResponse(null, { status: 204 }),
            ),
        );
        const create = renderHook(() => useCreateIssueExternalLink('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        const link = await create.result.current.mutateAsync({
            url: 'https://github.com/foo/bar/pull/42',
            title: 'feat: thing',
        });
        expect(link.id).toBe(7);
        expect(createBody.link_kind).toBe('pull_request');
        expect(createBody.url).toBe('https://github.com/foo/bar/pull/42');
        expect(createBody.title).toBe('feat: thing');

        const del = renderHook(() => useDeleteIssueExternalLink('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await expect(del.result.current.mutateAsync(7)).resolves.toBeUndefined();
    });

    it('omits title when not provided', async () => {
        let received: { title?: string | null } = {};
        server.use(
            http.post(
                'http://localhost:3000/api/issues/story/S1/external-links',
                async ({ request }) => {
                    received = (await request.json()) as typeof received;
                    return ok({
                        id: 1,
                        item_id: 'S1',
                        link_kind: 'pull_request',
                        url: 'https://github.com/foo/bar/pull/1',
                        title: null,
                        external_ref: '1',
                        created_at: '2026-06-30T00:00:00Z',
                        created_by_run_id: null,
                    });
                },
            ),
        );
        const create = renderHook(() => useCreateIssueExternalLink('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await create.result.current.mutateAsync({
            url: 'https://github.com/foo/bar/pull/1',
        });
        expect(received.title).toBeNull();
    });
});
