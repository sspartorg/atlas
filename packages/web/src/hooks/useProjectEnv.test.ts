import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useProjectEnv, useSaveProjectEnv } from './useProjectEnv.js';

describe('useProjectEnv', () => {
    it('reads and saves project env', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects/p1/env', () =>
                HttpResponse.json({ vars: [] }),
            ),
            http.put('http://localhost:3000/api/projects/p1/env', () =>
                HttpResponse.json({ vars: [{ key: 'A', value: 'X' }] }),
            ),
        );
        const read = renderHook(() => useProjectEnv('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(read.result.current.isSuccess).toBe(true));
        const save = renderHook(() => useSaveProjectEnv('p1'), { wrapper: makeWrapper() });
        const r = await save.result.current.mutateAsync([{ key: 'A', value: 'X' }]);
        expect(r.vars[0]?.key).toBe('A');
    });

    it('stays idle when projectId is null', () => {
        const { result } = renderHook(() => useProjectEnv(null), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('stays idle when enabled=false', () => {
        const { result } = renderHook(() => useProjectEnv('p1', false), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });
});
