import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useAiEnabled } from './useAiEnabled.js';

const BASE = 'http://localhost:3000/api';

describe('useAiEnabled', () => {
    it('returns aiEnabled=true when settings.ai_enabled is true', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Owner', ai_enabled: true, onboarding_complete: 1 }),
            ),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.aiEnabled).toBe(true);
    });

    it('returns aiEnabled=false when settings.ai_enabled is not true', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Owner', ai_enabled: false, onboarding_complete: 1 }),
            ),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.aiEnabled).toBe(false);
    });

    it('returns aiEnabled=undefined while loading', async () => {
        // Never resolve settings
        server.use(
            http.get(`${BASE}/settings`, () => new Promise(() => {})),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        // Initially isLoading should be true and aiEnabled undefined
        expect(result.current.aiEnabled).toBeUndefined();
        expect(result.current.isLoading).toBe(true);
    });

    it('returns aiEnabled=false when ai_enabled field is missing', async () => {
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Owner', onboarding_complete: 1 }),
            ),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        // ai_enabled not in data → false
        expect(result.current.aiEnabled).toBe(false);
    });
});
