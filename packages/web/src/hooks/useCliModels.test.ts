import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useCliModels,
    useCreateCliModel,
    useRemoveCliModel,
    useUpdateCliModel,
} from './useCliModels.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('cli model hooks', () => {
    it('list + create + update + remove', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => ok([])),
            http.post('http://localhost:3000/api/cli-models', () =>
                ok({ id: 'm1', cli: 'claude', model_name: 'opus' }),
            ),
            http.patch('http://localhost:3000/api/cli-models/m1', () =>
                ok({ id: 'm1', cli: 'claude', model_name: 'opus', note: 'n' }),
            ),
            http.delete('http://localhost:3000/api/cli-models/m1', () =>
                new HttpResponse(null, { status: 204 }),
            ),
        );
        const list = renderHook(() => useCliModels(), { wrapper: makeWrapper() });
        await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
        const create = renderHook(() => useCreateCliModel(), { wrapper: makeWrapper() });
        const c = await create.result.current.mutateAsync({ cli: 'claude', model_name: 'opus' });
        expect(c.id).toBe('m1');
        const update = renderHook(() => useUpdateCliModel(), { wrapper: makeWrapper() });
        await update.result.current.mutateAsync({ id: 'm1', note: 'n' });
        const remove = renderHook(() => useRemoveCliModel(), { wrapper: makeWrapper() });
        await expect(remove.result.current.mutateAsync('m1')).resolves.toBeUndefined();
    });
});
