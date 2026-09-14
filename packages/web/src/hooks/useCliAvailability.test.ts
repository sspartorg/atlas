import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { cliUnavailableMessage, useMissingCli } from './useCliAvailability.js';

const BASE = 'http://localhost:3000/api';

const ROWS = [
    { cli: 'claude', binary: 'claude', available: true, version: '1.0.0' },
    { cli: 'copilot', binary: 'copilot', available: false, version: null },
    { cli: 'ollama', binary: 'claude', available: true, version: '1.0.0' },
];

describe('useMissingCli', () => {
    it('returns the missing row plus an available alternative', async () => {
        server.use(http.get(`${BASE}/cli/availability`, () => HttpResponse.json(ROWS)));
        const { result } = renderHook(() => useMissingCli('copilot'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current).not.toBeNull());
        expect(result.current?.missing.binary).toBe('copilot');
        expect(result.current?.alternative).toBe('claude');
        expect(cliUnavailableMessage(result.current!, { beforeInstall: true })).toBe(
            'copilot is not installed on this machine — runs will fail until it is, or switch the agent to claude after installing.',
        );
    });

    it('returns null for an available CLI', async () => {
        server.use(http.get(`${BASE}/cli/availability`, () => HttpResponse.json(ROWS)));
        const { result } = renderHook(
            () => ({ missing: useMissingCli('claude'), probe: useMissingCli('copilot') }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.probe).not.toBeNull());
        expect(result.current.missing).toBeNull();
    });
});
