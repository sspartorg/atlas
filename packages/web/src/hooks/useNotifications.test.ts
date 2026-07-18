import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { makeNotification } from '../test-utils/factories.js';
import {
    useCancelNotification,
    useMarkAllRead,
    useMarkNotificationRead,
    useMarkNotificationSent,
    useNotifications,
    useResendNotification,
} from './useNotifications.js';

const ok = (b: JsonBodyType) => HttpResponse.json(b);

describe('useNotifications', () => {
    it('passes no query string for empty opts', async () => {
        server.use(
            http.get('http://localhost:3000/api/notifications', ({ request }) => {
                expect(request.url).not.toContain('kind=');
                return HttpResponse.json([]);
            }),
        );
        const { result } = renderHook(() => useNotifications(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('passes filters as query string', async () => {
        server.use(
            http.get('http://localhost:3000/api/notifications', ({ request }) => {
                expect(request.url).toContain('kind=needs_you');
                expect(request.url).toContain('external_status=sent');
                expect(request.url).toContain('limit=10');
                return HttpResponse.json([makeNotification({ id: 1 })]);
            }),
        );
        const { result } = renderHook(
            () => useNotifications({ kind: 'needs_you', external_status: 'sent', limit: 10 }),
            { wrapper: makeWrapper() },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('notification mutations', () => {
    it('all five hooks issue their requests', async () => {
        server.use(
            http.patch('http://localhost:3000/api/notifications/1/sent', () => new HttpResponse(null, { status: 204 })),
            http.post('http://localhost:3000/api/notifications/1/resend', () => ok(makeNotification({ id: 1 }))),
            http.post('http://localhost:3000/api/notifications/1/cancel', () => ok(makeNotification({ id: 1 }))),
            http.post('http://localhost:3000/api/notifications/mark-all-read', () => ok({ ok: true, changed: 3 })),
            http.post('http://localhost:3000/api/notifications/1/read', () => ok({ ok: true, changed: true })),
        );
        const sent = renderHook(() => useMarkNotificationSent(), { wrapper: makeWrapper() });
        await expect(sent.result.current.mutateAsync(1)).resolves.toBeUndefined();
        const resend = renderHook(() => useResendNotification(), { wrapper: makeWrapper() });
        const re = await resend.result.current.mutateAsync(1);
        expect(re.id).toBe(1);
        const cancel = renderHook(() => useCancelNotification(), { wrapper: makeWrapper() });
        await cancel.result.current.mutateAsync(1);
        const all = renderHook(() => useMarkAllRead(), { wrapper: makeWrapper() });
        const ar = await all.result.current.mutateAsync();
        expect(ar.ok).toBe(true);
        const read = renderHook(() => useMarkNotificationRead(), { wrapper: makeWrapper() });
        const rr = await read.result.current.mutateAsync(1);
        expect(rr.ok).toBe(true);
    });
});
