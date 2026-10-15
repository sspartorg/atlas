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
    useReminderHistory,
    useReminderFires,
    useSetReminderPaused,
    useSnoozeReminder,
    useDeleteReminder,
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

describe('useReminderHistory', () => {
    it('stays idle until enabled, then pages by 50', async () => {
        const offsets: string[] = [];
        server.use(
            http.get(`${BASE}/reminders`, ({ request }) => {
                const off = new URL(request.url).searchParams.get('offset') ?? '';
                offsets.push(off);
                return HttpResponse.json(off === '0' ? Array.from({ length: 50 }, (_, i) => ({ ...FIXTURE_ROW, id: i })) : []);
            }),
        );
        const { result, rerender } = renderHook(({ on }) => useReminderHistory(on), {
            wrapper: makeWrapper(),
            initialProps: { on: false },
        });
        expect(result.current.fetchStatus).toBe('idle');
        rerender({ on: true });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.hasNextPage).toBe(true);
        await result.current.fetchNextPage();
        await waitFor(() => expect(result.current.hasNextPage).toBe(false));
        expect(offsets).toEqual(['0', '50']);
    });
});

describe('useReminderFires', () => {
    it('loads the fire log only when enabled', async () => {
        server.use(http.get(`${BASE}/reminders/1/fires`, () => HttpResponse.json([{ notification_id: 1 }])));
        const { result } = renderHook(() => useReminderFires(1, true), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.data).toHaveLength(1));
    });
});

describe('pause / snooze / delete mutations', () => {
    it('hit their endpoints', async () => {
        const calls: string[] = [];
        server.use(
            http.patch(`${BASE}/reminders/1`, async ({ request }) => {
                calls.push(`patch ${JSON.stringify(await request.json())}`);
                return HttpResponse.json(FIXTURE_ROW);
            }),
            http.post(`${BASE}/reminders/1/snooze`, async ({ request }) => {
                calls.push(`snooze ${JSON.stringify(await request.json())}`);
                return HttpResponse.json(FIXTURE_ROW);
            }),
            http.delete(`${BASE}/reminders/1`, ({ request }) => {
                calls.push(`delete ${new URL(request.url).search}`);
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const wrapper = makeWrapper();
        const pause = renderHook(() => useSetReminderPaused(), { wrapper }).result;
        const snooze = renderHook(() => useSnoozeReminder(), { wrapper }).result;
        const del = renderHook(() => useDeleteReminder(), { wrapper }).result;
        await pause.current.mutateAsync({ id: 1, paused: true });
        await pause.current.mutateAsync({ id: 1, paused: false });
        await snooze.current.mutateAsync({ id: 1, minutes: 10 });
        await del.current.mutateAsync(1);
        expect(calls).toEqual([
            'patch {"status":"paused"}',
            'patch {"status":"active"}',
            'snooze {"minutes":10}',
            'delete ?hard=1',
        ]);
    });
});
