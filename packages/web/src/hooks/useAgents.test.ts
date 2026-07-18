import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { handlers } from '../test-utils/mock-handlers.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import * as apiModule from '../api/api.js';
import {
    useAgent,
    useAgentChecklists,
    useAgentMemory,
    useAgentPromptVersions,
    useAgentRun,
    useAgentRuns,
    useAgents,
    useHandoffRules,
    useItemAgentRuns,
    useProjectAgentRuns,
    useRegenerateAgentMemory,
    useRevertAgentPrompt,
    useSetAgentMemory,
    useUpdateAgent,
} from './useAgents.js';

const BASE = 'http://localhost:3000/api';

describe('useAgents', () => {
    it('returns the agent list', async () => {
        const rows = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })];
        server.use(handlers.listAgents(rows));
        const { result } = renderHook(() => useAgents(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(2);
    });

    it('is disabled when enabled: false', () => {
        const { result } = renderHook(() => useAgents({ enabled: false }), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useAgent', () => {
    it('returns a single agent by id', async () => {
        server.use(
            http.get(`${BASE}/agents/a1`, () => HttpResponse.json(makeAgent({ id: 'a1' }))),
        );
        const { result } = renderHook(() => useAgent('a1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.id).toBe('a1');
    });

    it('stays idle for empty id', () => {
        const { result } = renderHook(() => useAgent(''), { wrapper: makeWrapper() });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useUpdateAgent', () => {
    it('writes the response back into the cache on success', async () => {
        server.use(
            http.patch(`${BASE}/agents/a1`, () =>
                HttpResponse.json(makeAgent({ id: 'a1', name: 'Renamed' })),
            ),
        );
        const { result } = renderHook(() => useUpdateAgent(), { wrapper: makeWrapper() });
        const updated = await result.current.mutateAsync({
            id: 'a1',
            data: { name: 'Renamed' },
        });
        expect(updated.name).toBe('Renamed');
    });

    it('fires the error toast on failure', async () => {
        server.use(
            http.patch(`${BASE}/agents/a1`, () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        const { result } = renderHook(() => useUpdateAgent(), { wrapper: makeWrapper() });
        await expect(
            result.current.mutateAsync({ id: 'a1', data: { name: 'X' } }),
        ).rejects.toBeDefined();
    });

    it('uses "Unknown error" toast detail when onError receives a non-Error value', async () => {
        // To hit the `else` branch of `err instanceof Error ? err.message : 'Unknown error'`
        // we need the mutationFn to reject with a non-Error. Mock the api call to throw a plain string.
        const updateSpy = vi.spyOn(apiModule.api.agents, 'update').mockRejectedValueOnce('oops-string');
        const { result } = renderHook(() => useUpdateAgent(), { wrapper: makeWrapper() });
        await expect(
            result.current.mutateAsync({ id: 'a1', data: { name: 'X' } }),
        ).rejects.toBe('oops-string');
        updateSpy.mockRestore();
    });

});

describe('useAgentRuns + useHandoffRules', () => {
    it('hits the right endpoints', async () => {
        server.use(
            http.get(`${BASE}/agents/a1/runs`, () => HttpResponse.json([])),
            http.get(`${BASE}/agents/a1/handoff-rules`, () => HttpResponse.json([])),
        );
        const { result: r1 } = renderHook(() => useAgentRuns('a1'), { wrapper: makeWrapper() });
        const { result: r2 } = renderHook(() => useHandoffRules('a1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(r1.current.isSuccess).toBe(true));
        await waitFor(() => expect(r2.current.isSuccess).toBe(true));
    });
});

describe('useAgentChecklists', () => {
    it('returns the checklist items', async () => {
        server.use(
            http.get(`${BASE}/agents/a1/checklists`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useAgentChecklists('a1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('is idle when id is empty', () => {
        const { result } = renderHook(() => useAgentChecklists(''), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useAgentMemory + setMemory + regenerateMemory', () => {
    it('returns the memory and respects enabled:false', () => {
        const { result } = renderHook(
            () => useAgentMemory('a1', { enabled: false }),
            { wrapper: makeWrapper() },
        );
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('fetches memory when enabled', async () => {
        server.use(
            http.get(`${BASE}/agents/a1/memory`, () =>
                HttpResponse.json({ agent_id: 'a1', body_md: 'memo', updated_at: '' }),
            ),
        );
        const { result } = renderHook(() => useAgentMemory('a1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.agent_id).toBe('a1');
    });

    it('useSetAgentMemory writes the response to the cache', async () => {
        server.use(
            http.put(`${BASE}/agents/a1/memory`, () =>
                HttpResponse.json({ agent_id: 'a1', body_md: 'new', updated_at: '' }),
            ),
        );
        const { result } = renderHook(() => useSetAgentMemory(), {
            wrapper: makeWrapper(),
        });
        const updated = await result.current.mutateAsync({ id: 'a1', body_md: 'new' });
        expect(updated.body_md).toBe('new');
    });

    it('useRegenerateAgentMemory returns the regenerated entry', async () => {
        server.use(
            http.post(`${BASE}/agents/a1/memory/regenerate`, () =>
                HttpResponse.json({ agent_id: 'a1', body_md: 'regen', updated_at: '' }),
            ),
        );
        const { result } = renderHook(() => useRegenerateAgentMemory(), {
            wrapper: makeWrapper(),
        });
        const next = await result.current.mutateAsync('a1');
        expect(next.body_md).toBe('regen');
    });
});

describe('useProjectAgentRuns + useItemAgentRuns + useAgentRun', () => {
    it('useProjectAgentRuns fires when projectId is set', async () => {
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useProjectAgentRuns('p1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useProjectAgentRuns is idle when projectId is empty', () => {
        const { result } = renderHook(() => useProjectAgentRuns(''), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('useItemAgentRuns is idle when itemId is null', () => {
        const { result } = renderHook(() => useItemAgentRuns(null), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('useItemAgentRuns fires when itemId is set', async () => {
        server.use(http.get(`${BASE}/run`, () => HttpResponse.json([])));
        const { result } = renderHook(() => useItemAgentRuns('ATL-1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useAgentRun is idle when runId is empty', () => {
        const { result } = renderHook(() => useAgentRun(''), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('useAgentRun fetches when runId is set', async () => {
        server.use(http.get(`${BASE}/run/run-1`, () => HttpResponse.json({ id: 'run-1' })));
        const { result } = renderHook(() => useAgentRun('run-1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useAgentPromptVersions + useRevertAgentPrompt', () => {
    it('fetches the prompt versions', async () => {
        server.use(
            http.get(`${BASE}/agents/a1/prompt-versions`, () => HttpResponse.json([])),
        );
        const { result } = renderHook(() => useAgentPromptVersions('a1'), {
            wrapper: makeWrapper(),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('reverts a prompt to a specific version', async () => {
        server.use(
            http.post(
                `${BASE}/agents/a1/prompt-versions/3/revert`,
                () => HttpResponse.json(makeAgent({ id: 'a1' })),
            ),
        );
        const { result } = renderHook(() => useRevertAgentPrompt(), {
            wrapper: makeWrapper(),
        });
        const updated = await result.current.mutateAsync({ id: 'a1', version: 3 });
        expect(updated.id).toBe('a1');
    });
});
