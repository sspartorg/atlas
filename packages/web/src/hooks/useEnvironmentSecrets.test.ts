import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useEnvironmentSecrets, useSaveEnvironmentSecrets } from './useEnvironmentSecrets.js';

const BASE = 'http://localhost:3000/api';

describe('useEnvironmentSecrets', () => {
    it('fetches the environment secrets list', async () => {
        server.use(
            http.get(`${BASE}/environment-secrets`, () =>
                HttpResponse.json({ vars: [
                    { key: 'API_KEY', value: 'masked' },
                    { key: 'SECRET', value: 'masked' },
                ]}),
            ),
        );
        const { result } = renderHook(() => useEnvironmentSecrets(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect((result.current.data as { vars: unknown[] }).vars.length).toBe(2);
    });

    it('returns empty when no secrets exist', async () => {
        server.use(
            http.get(`${BASE}/environment-secrets`, () => HttpResponse.json({ vars: [] })),
        );
        const { result } = renderHook(() => useEnvironmentSecrets(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect((result.current.data as { vars: unknown[] }).vars).toEqual([]);
    });
});

describe('useSaveEnvironmentSecrets', () => {
    it('calls PUT /api/environment-secrets with the secrets array', async () => {
        let body: unknown = null;
        server.use(
            http.put(`${BASE}/environment-secrets`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ vars: [{ key: 'API_KEY', value: 'masked' }] });
            }),
            http.get(`${BASE}/environment-secrets`, () => HttpResponse.json({ vars: [] })),
        );
        const { result } = renderHook(() => useSaveEnvironmentSecrets(), { wrapper: makeWrapper() });
        await result.current.mutateAsync([{ key: 'API_KEY', value: 'my-secret' }]);
        expect(body).toEqual({ vars: [{ key: 'API_KEY', value: 'my-secret' }] });
    });
});
