import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useDashboard } from './useDashboard.js';

describe('useDashboard', () => {
    it('returns the dashboard response', async () => {
        server.use(
            http.get('http://localhost:3000/api/dashboard', () =>
                HttpResponse.json({ kpis: {}, awaiting_you: [], in_motion: [] }),
            ),
        );
        const { result } = renderHook(() => useDashboard(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeDefined();
    });
});
