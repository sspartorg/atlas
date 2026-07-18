import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useAiEnabled } from './useAiEnabled.js';

describe('useAiEnabled', () => {
    it('returns aiEnabled=true when settings says ai_enabled=true', async () => {
        server.use(
            http.get('http://localhost:3000/api/settings', () =>
                HttpResponse.json({ ai_enabled: true, owner_name: 'Owner', workspace_path: '/x' }),
            ),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.aiEnabled).toBe(true);
    });

    it('returns aiEnabled=false when settings says ai_enabled=false', async () => {
        server.use(
            http.get('http://localhost:3000/api/settings', () =>
                HttpResponse.json({ ai_enabled: false, owner_name: 'Owner', workspace_path: '/x' }),
            ),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.aiEnabled).toBe(false);
    });

    it('returns aiEnabled=undefined while loading (so the Topbar can skip the chip until we know)', () => {
        server.use(
            http.get('http://localhost:3000/api/settings', () => new Promise<Response>(() => {})),
        );
        const { result } = renderHook(() => useAiEnabled(), { wrapper: makeWrapper() });
        expect(result.current.isLoading).toBe(true);
        expect(result.current.aiEnabled).toBeUndefined();
    });
});
