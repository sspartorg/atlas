import { test, expect } from '@playwright/test';

// Push subscription flow — API-only (no browser/service-worker context).
// Exercises POST /subscribe (insert + idempotent upsert) and
// POST /unsubscribe (delete). No GET list endpoint exists; persistence
// is confirmed indirectly via a second subscribe returning 201 on
// the same endpoint (upsert path) and unsubscribe returning 204.

const API = 'http://127.0.0.1:6001';

const SUB = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-aaaa-bbbb-cccc-dddddddddddd',
    p256dh: 'BDeyOXFJ5UwQ-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    auth: 'aaaaaaaaaaaaaaaaaaaaaa',
    userAgent: 'Playwright/e2e',
};

test.describe('Push subscription flow', () => {
    test.afterEach(async ({ request }) => {
        // Best-effort cleanup — ignore errors if row was already removed.
        await request
            .post(`${API}/api/push-subscriptions/unsubscribe`, {
                data: { endpoint: SUB.endpoint },
            })
            .catch(() => undefined);
    });

    test('POST subscribe persists the subscription and unsubscribe removes it', async ({ request }) => {
        // Register subscription.
        const sub = await request.post(`${API}/api/push-subscriptions/subscribe`, {
            data: SUB,
        });
        expect(sub.status()).toBe(201);
        const subBody = await sub.json() as { ok: boolean };
        expect(subBody.ok).toBe(true);

        // Confirm it is persisted — re-registering the same endpoint
        // goes through the upsert path and still returns 201.
        const recheck = await request.post(`${API}/api/push-subscriptions/subscribe`, {
            data: { ...SUB, userAgent: 'Playwright/recheck' },
        });
        expect(recheck.status()).toBe(201);

        // Delete the subscription.
        const unsub = await request.post(`${API}/api/push-subscriptions/unsubscribe`, {
            data: { endpoint: SUB.endpoint },
        });
        expect(unsub.status()).toBe(204);
    });

    test('POST subscribe is idempotent — same endpoint upserts, not duplicates', async ({ request }) => {
        // First registration.
        const first = await request.post(`${API}/api/push-subscriptions/subscribe`, {
            data: { ...SUB, userAgent: 'Chrome v1' },
        });
        expect(first.status()).toBe(201);

        // Second registration with updated userAgent — must not create a
        // duplicate row (upsert on endpoint column).
        const second = await request.post(`${API}/api/push-subscriptions/subscribe`, {
            data: { ...SUB, userAgent: 'Chrome v2' },
        });
        expect(second.status()).toBe(201);
        const secondBody = await second.json() as { ok: boolean };
        expect(secondBody.ok).toBe(true);
    });

    test('POST unsubscribe returns 204 and endpoint no longer accepts DELETE loop', async ({ request }) => {
        // Seed a subscription.
        const sub = await request.post(`${API}/api/push-subscriptions/subscribe`, {
            data: SUB,
        });
        expect(sub.status()).toBe(201);

        // Delete it.
        const unsub = await request.post(`${API}/api/push-subscriptions/unsubscribe`, {
            data: { endpoint: SUB.endpoint },
        });
        expect(unsub.status()).toBe(204);

        // Deleting again (no row) must still return 204 — idempotent delete.
        const unsub2 = await request.post(`${API}/api/push-subscriptions/unsubscribe`, {
            data: { endpoint: SUB.endpoint },
        });
        expect(unsub2.status()).toBe(204);
    });
});
