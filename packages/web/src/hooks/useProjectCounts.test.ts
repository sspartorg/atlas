import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useProjectCounts } from './useProjectCounts.js';

describe('useProjectCounts', () => {
    it('fetches counts for a non-empty project id', async () => {
        server.use(
            http.get('http://localhost:3000/api/counts/project/p1', () =>
                HttpResponse.json({ epics: 1, stories: 2, bugs: 3 }),
            ),
        );
        const { result } = renderHook(() => useProjectCounts('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeDefined();
    });

    it('stays disabled when projectId is empty', () => {
        const { result } = renderHook(() => useProjectCounts(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});
