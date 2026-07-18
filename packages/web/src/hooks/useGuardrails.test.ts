import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCreateGuardrail,
    useDeleteGuardrail,
    useGuardrails,
    useSaveGuardrails,
    useUpdateGuardrail,
    useGuardrailScripts,
    useCreateGuardrailScript,
    useUpdateGuardrailScript,
    useDeleteGuardrailScript,
} from './useGuardrails.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useGuardrails + mutations', () => {
    it('lists guardrails', async () => {
        server.use(
            http.get('http://localhost:3000/api/guardrails', () => ok({ rules: [], published_at: null })),
        );
        const { result } = renderHook(() => useGuardrails(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('guardrail scripts CRUD', async () => {
        server.use(
            http.get('http://localhost:3000/api/guardrail-scripts', () =>
                ok([{ id: 's1', name: 'Test script', description: 'desc', body_sh: '#!/bin/sh', body_ps1: '', sort_order: 0 }]),
            ),
            http.post('http://localhost:3000/api/guardrail-scripts', () =>
                ok({ id: 's2', name: 'New script', description: null, body_sh: '#!/bin/sh', body_ps1: '', sort_order: 1 }),
            ),
            http.patch('http://localhost:3000/api/guardrail-scripts/s2', () =>
                ok({ id: 's2', name: 'Updated script', description: null, body_sh: '#!/bin/sh', body_ps1: '', sort_order: 1 }),
            ),
            http.delete('http://localhost:3000/api/guardrail-scripts/s2', () => new HttpResponse(null, { status: 204 })),
        );
        // list
        const list = renderHook(() => useGuardrailScripts(), { wrapper: makeWrapper() });
        await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
        // create
        const create = renderHook(() => useCreateGuardrailScript(), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({ name: 'New script', body_sh: '#!/bin/sh', body_ps1: '' });
        expect(c.id).toBe('s2');
        // update
        const update = renderHook(() => useUpdateGuardrailScript(), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 's2', patch: { name: 'Updated script' } });
        // delete
        const del = renderHook(() => useDeleteGuardrailScript(), { wrapper: makeWrapper() });
        await expect(del.result.current.mutateAsync('s2')).resolves.toBeUndefined();
    });

    it('create/update/delete/save mutations', async () => {
        server.use(
            http.post('http://localhost:3000/api/guardrails', () =>
                ok({ id: 'g1', category: 'file_system', rule_text: 't', detail: null, severity: 'warn' }),
            ),
            http.patch('http://localhost:3000/api/guardrails/g1', () =>
                ok({ id: 'g1', category: 'file_system', rule_text: 't2', detail: null, severity: 'warn' }),
            ),
            http.delete('http://localhost:3000/api/guardrails/g1', () => new HttpResponse(null, { status: 204 })),
            http.post('http://localhost:3000/api/guardrails/save', () => ok({ ok: true, published_at: 'now' })),
        );
        const create = renderHook(() => useCreateGuardrail(), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({
            category: 'file_system',
            rule_text: 't',
            detail: null,
            severity: 'warn',
        });
        expect(c.id).toBe('g1');
        const update = renderHook(() => useUpdateGuardrail(), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 'g1', patch: { rule_text: 't2' } });
        const del = renderHook(() => useDeleteGuardrail(), { wrapper: makeWrapper() });
        await expect(del.result.current.mutateAsync('g1')).resolves.toBeUndefined();
        const save = renderHook(() => useSaveGuardrails(), { wrapper: makeWrapper() });
        const s = await save.result.current.mutateAsync();
        expect(s.ok).toBe(true);
    });
});
