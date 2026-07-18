import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useEnv, useUpdateEnv } from './useEnv.js';

function makeWrapperWithClient(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, null, children),
        );
    };
}

describe('useEnv', () => {
    it('reads env vars and updates via PATCH', async () => {
        server.use(
            http.get('http://localhost:3000/api/settings/env', () =>
                HttpResponse.json({ vars: [{ key: 'A', value: '1' }] }),
            ),
            http.patch('http://localhost:3000/api/settings/env', () =>
                HttpResponse.json({ vars: [{ key: 'A', value: '2' }] }),
            ),
        );
        const env = renderHook(() => useEnv(), { wrapper: makeWrapper() });
        await waitFor(() => expect(env.result.current.isSuccess).toBe(true));
        const u = renderHook(() => useUpdateEnv(), { wrapper: makeWrapper() });
        const r = await u.result.current.mutateAsync([{ key: 'A', value: '2' }]);
        expect(r.vars[0]?.value).toBe('2');
    });

    it('useUpdateEnv onSuccess calls qc.setQueryData to update the cache', async () => {
        const initialData = { vars: [{ key: 'X', value: 'before' }] };
        const updatedData = { vars: [{ key: 'X', value: 'after' }] };

        server.use(
            http.get('http://localhost:3000/api/settings/env', () =>
                HttpResponse.json(initialData),
            ),
            http.patch('http://localhost:3000/api/settings/env', () =>
                HttpResponse.json(updatedData),
            ),
        );

        const qc = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        const wrapper = makeWrapperWithClient(qc);

        // Seed the cache with initial data
        qc.setQueryData(['settings', 'env'], initialData);

        const { result } = renderHook(() => useUpdateEnv(), { wrapper });
        await result.current.mutateAsync([{ key: 'X', value: 'after' }]);

        // onSuccess should have called qc.setQueryData with the response
        const cached = qc.getQueryData<typeof updatedData>(['settings', 'env']);
        expect(cached?.vars[0]?.value).toBe('after');
    });

    it('returns initial data from the cache immediately on second mount', async () => {
        const data = { vars: [{ key: 'CACHED', value: 'yes' }] };
        server.use(
            http.get('http://localhost:3000/api/settings/env', () =>
                HttpResponse.json(data),
            ),
        );

        const qc = new QueryClient({
            defaultOptions: {
                queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
                mutations: { retry: false },
            },
        });
        qc.setQueryData(['settings', 'env'], data);

        const wrapper = makeWrapperWithClient(qc);
        const { result } = renderHook(() => useEnv(), { wrapper });

        // Data already in cache — should be available synchronously
        expect(result.current.data).toEqual(data);
    });
});
