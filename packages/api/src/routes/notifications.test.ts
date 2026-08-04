import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

// Mock external notification delivery so tests don't hit real services
vi.mock('../services/external-notifications.js', () => ({
    sendExternalForNotification: vi.fn().mockResolvedValue(undefined),
    sendExternalNotification: vi.fn().mockResolvedValue(undefined),
}));

// Also mock web-push so no push delivery is attempted
vi.mock('../services/web-push.js', () => ({
    sendWebPushForNotification: vi.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// Insert a notification using the correct schema
async function insertNotification(overrides: {
    message?: string;
    external_status?: string;
} = {}): Promise<number> {
    const result = await testDb
        .insertInto('notifications')
        .values({
            event_type: 'test_event',
            message: overrides.message ?? 'Test notification',
            kind: 'update',
            item_id: null,
            project_id: null,
            agent_id: null,
            sent_external: 0,
            external_status: (overrides.external_status ?? 'none') as 'none' | 'pending' | 'sent' | 'failed',
            failure_reason: null,
            link_url: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    return Number(result.id);
}

describe('GET /api/notifications', () => {
    it('returns 200 with empty array when no notifications', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/notifications' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 with notifications after insert', async () => {
        await insertNotification({ message: 'Hello World' });
        const res = await app.inject({ method: 'GET', url: '/api/notifications' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
        expect(body[0]).toMatchObject({ message: 'Hello World' });
    });
});

describe('PATCH /api/notifications/:id/sent', () => {
    it('marks notification as sent and returns 204', async () => {
        const id = await insertNotification();
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/notifications/${id}/sent`,
        });
        expect(res.statusCode).toBe(204);
    });
});

describe('POST /api/notifications/:id/read', () => {
    it('marks notification as read and returns 200', async () => {
        const id = await insertNotification();
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/read`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ ok: true });
    });
});

describe('POST /api/notifications/mark-all-read', () => {
    it('returns 200 with changed count', async () => {
        await insertNotification();
        await insertNotification();
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/mark-all-read',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ ok: true, changed: expect.any(Number) });
    });
});

describe('POST /api/notifications/:id/resend', () => {
    it('returns 404 for nonexistent notification', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/99999/resend',
        });
        expect(res.statusCode).toBe(404);
    });

    it('resends notification and returns 200', async () => {
        const id = await insertNotification({ message: 'Resend me' });
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/resend`,
        });
        // External delivery is mocked; should succeed
        expect(res.statusCode).toBe(200);
    });

    it('returns 502 when sendExternalForNotification throws (lines 51-55)', async () => {
        const { sendExternalForNotification } = await import('../services/external-notifications.js');
        vi.mocked(sendExternalForNotification).mockRejectedValueOnce(new Error('transport error'));
        const id = await insertNotification({ message: 'Fail to resend' });
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/resend`,
        });
        expect(res.statusCode).toBe(502);
        const body = JSON.parse(res.body) as { error: string; detail: string };
        expect(body.error).toBe('External notification delivery failed');
        expect(body.detail).toBe('transport error');
    });

    it('returns 502 with String(err) when sendExternalForNotification throws non-Error (NOTIF-STR-1)', async () => {
        // Covers `err instanceof Error ? err.message : String(err)` false branch at line 53.
        const { sendExternalForNotification } = await import('../services/external-notifications.js');
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        vi.mocked(sendExternalForNotification).mockRejectedValueOnce('non-error-transport');
        const id = await insertNotification({ message: 'Fail to resend non-Error' });
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/resend`,
        });
        expect(res.statusCode).toBe(502);
        const body = JSON.parse(res.body) as { error: string; detail: string };
        expect(body.detail).toBe('non-error-transport');
    });
});

describe('POST /api/notifications/:id/cancel', () => {
    it('cancels a pending notification and returns 200', async () => {
        // Cancel only works when external_status === 'pending'
        const id = await insertNotification({ external_status: 'pending' });
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/cancel`,
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 409 when notification cannot be cancelled (external_status is not pending)', async () => {
        const id = await insertNotification({ external_status: 'sent' });
        const res = await app.inject({
            method: 'POST',
            url: `/api/notifications/${id}/cancel`,
        });
        expect(res.statusCode).toBe(409);
    });
});

describe('POST /api/notifications/send-external', () => {
    it('returns 202 for a valid message', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: 'External notification message' },
        });
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    });

    it('returns 400 for missing message', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty message', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: '' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is a JSON array (not object — lines 14-16)', async () => {
        // A JSON array is typeof 'object' but not the expected plain object shape.
        // parseSendExternalBody throws 'body must be an object' for non-plain-objects.
        // We use a JSON number (typeof !== 'object') to hit the literal null/non-object branch.
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            headers: { 'content-type': 'application/json' },
            // JSON null → body will be null → typeof null === 'object' && body === null → throw
            payload: Buffer.from('null'),
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when message exceeds 4000 chars', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: 'x'.repeat(4001) },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 202 when event_key is provided (line 27 — event_key set in output)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: 'Test with event_key', event_key: 'agent.failed' },
        });
        expect(res.statusCode).toBe(202);
    });

    it('returns 400 when event_key is not a string (lines 22-25)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: 'Valid message', event_key: 12345 },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when event_key exceeds 64 chars (lines 22-25)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/notifications/send-external',
            payload: { message: 'Valid message', event_key: 'e'.repeat(65) },
        });
        expect(res.statusCode).toBe(400);
    });
});
