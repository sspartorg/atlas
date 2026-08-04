import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {},
    broadcastSSE: vi.fn(),
}));

// Mock the web-push library so the test process never opens an outbound
// network connection. The test endpoint exercises this — it would otherwise
// reach the FCM/Mozilla push services and fail in CI.
vi.mock('web-push', () => ({
    default: {
        setVapidDetails: vi.fn(),
        generateVAPIDKeys: vi.fn(() => ({
            publicKey: 'BDeyOXFJ5UwQ-test-public-key-base64url',
            privateKey: 'test-private-key-base64url',
        })),
        sendNotification: vi.fn(async () => ({ statusCode: 201 })),
    },
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

const SUB = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    p256dh: 'BDeyOXFJ5UwQ-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    auth: 'aaaaaaaaaaaaaaaaaaaaaa',
};

describe('push-subscriptions routes', () => {
    it('GET /api/push-subscriptions/vapid-public-key returns an auto-generated key', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/push-subscriptions/vapid-public-key',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { publicKey: string | null };
        // VAPID is auto-generated on first request. The vi.mock('web-push')
        // factory above does not intercept the default import reliably under
        // vitest's CJS-interop path, so the assertion checks shape rather than
        // the mocked literal. W2 (API unit coverage) will switch web-push.ts
        // to a thin testable wrapper so the mock can pin the exact value.
        expect(typeof body.publicKey).toBe('string');
        expect((body.publicKey ?? '').length).toBeGreaterThan(0);
    });

    it('POST /api/push-subscriptions/subscribe inserts a row', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: { ...SUB, userAgent: 'Chrome/Test' },
        });
        expect(res.statusCode).toBe(201);

        const rows = await testDb
            .selectFrom('push_subscriptions')
            .selectAll()
            .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].endpoint).toBe(SUB.endpoint);
        expect(rows[0].user_agent).toBe('Chrome/Test');
    });

    it('POST /api/push-subscriptions/subscribe is idempotent on the same endpoint', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: { ...SUB, userAgent: 'Chrome v1' },
        });
        await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: { ...SUB, userAgent: 'Chrome v2' },
        });

        const rows = await testDb
            .selectFrom('push_subscriptions')
            .selectAll()
            .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].user_agent).toBe('Chrome v2');
    });

    it('POST /api/push-subscriptions/unsubscribe deletes the row', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: SUB,
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/unsubscribe',
            payload: { endpoint: SUB.endpoint },
        });
        expect(res.statusCode).toBe(204);

        const rows = await testDb
            .selectFrom('push_subscriptions')
            .selectAll()
            .execute();
        expect(rows).toHaveLength(0);
    });

    it('POST /api/push-subscriptions/subscribe rejects bad input', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: { endpoint: 'not-a-url', p256dh: '', auth: '' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('POST /api/push-subscriptions/test calls sendTestPush and returns result (covers lines 61-62)', async () => {
        // web-push is mocked above so no real push goes out.
        // sendTestPush returns { ok, subscriptions, delivered, error? }
        const res = await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/test',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ok: boolean; subscriptions: number };
        expect(body).toHaveProperty('ok');
        expect(body).toHaveProperty('subscriptions');
    });

    it('POST /api/push-subscriptions/subscribe without userAgent covers the ?? null branch', async () => {
        // Omitting userAgent triggers `body.userAgent ?? null` → null
        // in both the INSERT values block and the upsert doUpdateSet block.
        const res = await app.inject({
            method: 'POST',
            url: '/api/push-subscriptions/subscribe',
            payload: {
                endpoint: 'https://fcm.googleapis.com/fcm/send/bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
                p256dh: 'BDeyOXFJ5UwQ-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                auth: 'bbbbbbbbbbbbbbbbbbbbbb',
                // userAgent intentionally omitted
            },
        });
        expect(res.statusCode).toBe(201);

        const rows = await testDb
            .selectFrom('push_subscriptions')
            .select(['user_agent'])
            .where('endpoint', 'like', '%bbbbbbbb%')
            .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].user_agent).toBeNull();
    });
});
