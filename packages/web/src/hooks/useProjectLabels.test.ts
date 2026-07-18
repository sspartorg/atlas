import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useProjectLabels, useInvalidateProjectLabels } from './useProjectLabels.js';

describe('useProjectLabels', () => {
    it('fetches project-scoped labels when a projectId is given', async () => {
        server.use(
            http.get('http://localhost:3000/api/labels', ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get('project_id')).toBe('p1');
                return HttpResponse.json({ labels: ['urgent', 'frontend'] });
            }),
        );
        const { result } = renderHook(() => useProjectLabels('p1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.labels).toEqual(['urgent', 'frontend']);
    });

    it('stays idle when projectId is undefined and workspace is not set', () => {
        const { result } = renderHook(() => useProjectLabels(undefined), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('fetches workspace labels when opts.workspace=true and id is undefined', async () => {
        server.use(
            http.get('http://localhost:3000/api/labels', () =>
                HttpResponse.json({ labels: ['a', 'b'] }),
            ),
        );
        const { result } = renderHook(
            () => useProjectLabels(undefined, { workspace: true }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useInvalidateProjectLabels', () => {
    it('returns a callable that invalidates without throwing', () => {
        const { result } = renderHook(() => useInvalidateProjectLabels(), {
            wrapper: makeWrapper(),
        });
        expect(typeof result.current).toBe('function');
        expect(() => result.current()).not.toThrow();
    });
});
