import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCreateProjectGuardrail,
    useDeleteProjectGuardrail,
    useProjectGuardrails,
    useToggleProjectGuardrail,
    useUpdateProjectGuardrail,
    useProjectGuardrailScripts,
    useCreateProjectGuardrailScript,
    useUpdateProjectGuardrailScript,
    useDeleteProjectGuardrailScript,
} from './useProjectGuardrails.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useProjectGuardrails', () => {
    it('list and CRUD/toggle', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects/p1/guardrails', () => ok([])),
            http.post('http://localhost:3000/api/projects/p1/guardrails', () =>
                ok({ id: 'g1', title: 'T', body_md: 'b' }),
            ),
            http.patch('http://localhost:3000/api/projects/p1/guardrails/g1', () =>
                ok({ id: 'g1', title: 'T2', body_md: 'b' }),
            ),
            http.patch('http://localhost:3000/api/projects/p1/guardrails/g1/toggle', () =>
                ok({ id: 'g1', enabled: 0 }),
            ),
            http.delete('http://localhost:3000/api/projects/p1/guardrails/g1', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const list = renderHook(() => useProjectGuardrails('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
        const create = renderHook(() => useCreateProjectGuardrail('p1'), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({ title: 'T', body_md: 'b' });
        expect(c.id).toBe('g1');
        const update = renderHook(() => useUpdateProjectGuardrail('p1'), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 'g1', data: { title: 'T2' } });
        const toggle = renderHook(() => useToggleProjectGuardrail('p1'), { wrapper: makeWrapper() });
        await toggle.result.current.mutateAsync({ id: 'g1', enabled: 0 });
        const del = renderHook(() => useDeleteProjectGuardrail('p1'), { wrapper: makeWrapper() });
        await expect(del.result.current.mutateAsync('g1')).resolves.toBeUndefined();
    });

    it('stays idle for empty projectId', () => {
        const { result } = renderHook(() => useProjectGuardrails(undefined), {
            wrapper: makeWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('project guardrail scripts CRUD', async () => {
        server.use(
            http.get('http://localhost:3000/api/projects/p1/guardrail-scripts', () =>
                ok([{ id: 's1', name: 'Script', description: null, body_sh: '#!/bin/sh', body_ps1: '', sort_order: 0 }]),
            ),
            http.post('http://localhost:3000/api/projects/p1/guardrail-scripts', () =>
                ok({ id: 's2', name: 'New', description: null, body_sh: '#!/bin/sh', body_ps1: '', sort_order: 1 }),
            ),
            http.patch('http://localhost:3000/api/projects/p1/guardrail-scripts/s2', () =>
                ok({ id: 's2', name: 'Updated', description: null, body_sh: '#!/bin/sh', body_ps1: '', sort_order: 1 }),
            ),
            http.delete('http://localhost:3000/api/projects/p1/guardrail-scripts/s2', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const list = renderHook(() => useProjectGuardrailScripts('p1'), { wrapper: makeWrapper() });
        await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
        const create = renderHook(() => useCreateProjectGuardrailScript('p1'), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({ name: 'New', body_sh: '#!/bin/sh', body_ps1: '' });
        expect(c.id).toBe('s2');
        const update = renderHook(() => useUpdateProjectGuardrailScript('p1'), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 's2', patch: { name: 'Updated' } });
        const del = renderHook(() => useDeleteProjectGuardrailScript('p1'), { wrapper: makeWrapper() });
        await expect(del.result.current.mutateAsync('s2')).resolves.toBeUndefined();
    });
});
