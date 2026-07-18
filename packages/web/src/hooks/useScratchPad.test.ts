import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useScratchPadList,
    useCreateScratchPad,
    useUpdateScratchPad,
    useDeleteScratchPad,
} from './useScratchPad.js';

const BASE = 'http://localhost:3000/api';

describe('useScratchPadList', () => {
    it('returns the list', async () => {
        server.use(
            http.get(`${BASE}/scratch-pad`, () =>
                HttpResponse.json([
                    { id: 's1', title: 'Note 1', body: '', created_at: '', updated_at: '' },
                ]),
            ),
        );
        const { result } = renderHook(() => useScratchPadList(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });
});

describe('useCreateScratchPad', () => {
    it('posts and resolves with the new row', async () => {
        server.use(
            http.post(`${BASE}/scratch-pad`, () =>
                HttpResponse.json({
                    id: 's2',
                    title: 'New',
                    body: '',
                    created_at: '',
                    updated_at: '',
                }),
            ),
        );
        const { result } = renderHook(() => useCreateScratchPad(), { wrapper: makeWrapper() });
        const row = await result.current.mutateAsync({});
        expect(row.id).toBe('s2');
    });
});

describe('useUpdateScratchPad', () => {
    it('patches an existing row', async () => {
        server.use(
            http.patch(`${BASE}/scratch-pad/s1`, () =>
                HttpResponse.json({
                    id: 's1',
                    title: 'Renamed',
                    body: '',
                    created_at: '',
                    updated_at: '',
                }),
            ),
        );
        const { result } = renderHook(() => useUpdateScratchPad(), { wrapper: makeWrapper() });
        const row = await result.current.mutateAsync({ id: 's1', patch: { title: 'Renamed' } });
        expect(row.title).toBe('Renamed');
    });
});

describe('useDeleteScratchPad', () => {
    it('deletes by id', async () => {
        server.use(http.delete(`${BASE}/scratch-pad/s1`, () => new HttpResponse(null, { status: 204 })));
        const { result } = renderHook(() => useDeleteScratchPad(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync('s1')).resolves.toBeUndefined();
    });
});
