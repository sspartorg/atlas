import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useSidenavCounts } from './useSidenavCounts.js';

describe('useSidenavCounts', () => {
    it('returns the empty default before fetch resolves', () => {
        server.use(
            http.get('http://localhost:3000/api/counts', () =>
                HttpResponse.json({
                    projects: 5,
                    epics: 3,
                    issues: 10,
                    queue: 2,
                    agents: 1,
                    notifications: 0,
                }),
            ),
        );
        const { result } = renderHook(() => useSidenavCounts(), { wrapper: makeWrapper() });
        expect(result.current.projects).toBe(0);
    });

    it('returns counts after fetch resolves', async () => {
        server.use(
            http.get('http://localhost:3000/api/counts', () =>
                HttpResponse.json({
                    projects: 5,
                    epics: 3,
                    issues: 10,
                    queue: 2,
                    agents: 1,
                    notifications: 0,
                }),
            ),
        );
        const { result } = renderHook(() => useSidenavCounts(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.projects).toBe(5));
    });
});
