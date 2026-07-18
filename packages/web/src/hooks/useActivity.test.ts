import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useActivity } from './useActivity.js';

describe('useActivity', () => {
    it('fetches activity items for an issue', async () => {
        server.use(
            http.get('http://localhost:3000/api/issues/story/S1/activity', () =>
                HttpResponse.json([{ id: 1, kind: 'comment' }]),
            ),
        );
        const { result } = renderHook(() => useActivity('story', 'S1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });

    it('is idle when issueId is empty', () => {
        const { result } = renderHook(() => useActivity('story', ''), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('respects opts.enabled=false', () => {
        const { result } = renderHook(() => useActivity('story', 'S1', { enabled: false }), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });
});
