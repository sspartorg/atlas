import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import {
    useReminders,
    useCreateReminder,
    useUpdateReminder,
    useCancelReminder,
} from './useReminders.js';

const BASE = 'http://localhost:3000/api';

const FIXTURE_ROW = {
    id: 1,
    label: 'ping',
    body: 'ping',
    schedule: { kind: 'once' as const, at: '2030-01-01T00:00:00Z' },
    channel: 'notification' as const,
    status: 'active' as const,
    next_fire_at: '2030-01-01T00:00:00Z',
    created_at: '2026-06-09T00:00:00Z',
    created_by_agent_id: null,
};

describe('useReminders', () => {
    it('returns the list', async () => {
        server.use(http.get(`${BASE}/reminders`, () => HttpResponse.json([FIXTURE_ROW])));
        const { result } = renderHook(() => useReminders(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toHaveLength(1);
    });
});

describe('useCreateReminder', () => {
    it('posts and returns the new row', async () => {
        server.use(
            http.post(`${BASE}/reminders`, () => HttpResponse.json({ ...FIXTURE_ROW, id: 2 })),
        );
        const { result } = renderHook(() => useCreateReminder(), { wrapper: makeWrapper() });
        const row = await result.current.mutateAsync({
            label: 'msg',
            body: 'msg',
            schedule: { kind: 'once', at: '2030-01-01T00:00:00Z' },
            channel: 'notification',
        });
        expect(row.id).toBe(2);
    });
});

describe('useUpdateReminder', () => {
    it('patches an existing reminder', async () => {
        server.use(
            http.patch(`${BASE}/reminders/1`, () =>
                HttpResponse.json({ ...FIXTURE_ROW, body: 'edited' }),
            ),
        );
        const { result } = renderHook(() => useUpdateReminder(), { wrapper: makeWrapper() });
        const row = await result.current.mutateAsync({ id: 1, patch: { body: 'edited' } });
        expect(row.body).toBe('edited');
    });
});

describe('useCancelReminder', () => {
    it('cancels an existing reminder', async () => {
        server.use(
            http.delete(`${BASE}/reminders/1`, () => new HttpResponse(null, { status: 204 })),
        );
        const { result } = renderHook(() => useCancelReminder(), { wrapper: makeWrapper() });
        await expect(result.current.mutateAsync(1)).resolves.toBeUndefined();
    });
});
