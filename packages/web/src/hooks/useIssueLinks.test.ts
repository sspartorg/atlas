import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCreateIssueLink,
    useDeleteIssueLink,
    useIssueLinks,
} from './useIssueLinks.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useIssueLinks', () => {
    it('fetches links', async () => {
        server.use(http.get('http://localhost:3000/api/issues/story/S1/links', () => ok([])));
        const { result } = renderHook(() => useIssueLinks('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('is idle when disabled', () => {
        const { result } = renderHook(() => useIssueLinks('story', 'S1', { enabled: false }), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('create + delete mutations', async () => {
        server.use(
            http.post('http://localhost:3000/api/issues/story/S1/links', () => ok({ id: 1 })),
            http.delete('http://localhost:3000/api/issues/links/1', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const create = renderHook(() => useCreateIssueLink('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await create.result.current.mutateAsync({ toType: 'bug', toId: 'B1' });
        const del = renderHook(() => useDeleteIssueLink('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await expect(del.result.current.mutateAsync(1)).resolves.toBeUndefined();
    });
});
