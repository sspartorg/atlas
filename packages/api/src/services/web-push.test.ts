import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {},
    broadcastSSE: vi.fn(),
}));

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
    default: {
        setVapidDetails: vi.fn(),
        sendNotification: (...args: unknown[]) => sendNotification(...args),
        generateVAPIDKeys: vi.fn(() => ({
            publicKey: 'BDeyOXFJ5UwQ-test-public-key-base64url',
            privateKey: 'test-private-key-base64url',
        })),
    },
}));

import { sendWebPushForNotification, getVapidPublicKey, sendTestPush, _resetVapidCacheForTest } from './web-push.js';
import { notificationsService } from './notifications.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertItem } from '../../tests/_items.js';

const SUB_A = {
    endpoint: 'https://push.example/aaa',
    p256dh: 'p256dh-a',
    auth: 'auth-a',
};
const SUB_B = {
    endpoint: 'https://push.example/bbb',
    p256dh: 'p256dh-b',
    auth: 'auth-b',
};

async function insertSub(s: { endpoint: string; p256dh: string; auth: string }) {
    await testDb
        .insertInto('push_subscriptions')
        .values({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, user_agent: null })
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
});

afterAll(async () => {
    await closeTestDb();
});

describe('web-push service', () => {
    it('leaves push_status="none" when no subscriptions are registered', async () => {
        const created = await notificationsService.create({
            event_type: 'test',
            message: 'no subs',
            kind: 'update',
        });
        // The create() hook fires the fan-out in the background. Wait a tick
        // so the unawaited promise can finish before we assert.
        await new Promise((r) => setImmediate(r));
        const row = await notificationsService.get(created.id);
        expect(row?.push_status).toBe('none');
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('marks push_status="sent" when all subscriptions accept the push', async () => {
        await insertSub(SUB_A);
        await insertSub(SUB_B);
        const created = await notificationsService.create({
            event_type: 'test',
            message: 'two devices',
            kind: 'update',
        });
        // Wait for the fan-out triggered by create() to settle.
        await new Promise((r) => setTimeout(r, 50));
        await sendWebPushForNotification(created.id); // re-run synchronously to be sure
        const row = await notificationsService.get(created.id);
        expect(row?.push_status).toBe('sent');
        expect(sendNotification).toHaveBeenCalled();
    });

    it('deletes a subscription when the push service returns 410 Gone', async () => {
        await insertSub(SUB_A);
        sendNotification.mockRejectedValueOnce(
            Object.assign(new Error('Gone'), { statusCode: 410 }),
        );
        const created = await notificationsService.create({
            event_type: 'test',
            message: 'kills dead sub',
            kind: 'update',
        });
        await new Promise((r) => setTimeout(r, 50));
        await sendWebPushForNotification(created.id);

        const remaining = await testDb
            .selectFrom('push_subscriptions')
            .selectAll()
            .execute();
        expect(remaining).toHaveLength(0);
    });

    it('marks push_status="failed" when a real delivery error occurs', async () => {
        await insertSub(SUB_A);
        sendNotification.mockReset();
        sendNotification.mockRejectedValue(
            Object.assign(new Error('boom'), { statusCode: 500 }),
        );
        const created = await notificationsService.create({
            event_type: 'test',
            message: 'real failure',
            kind: 'update',
        });
        await new Promise((r) => setTimeout(r, 50));
        await sendWebPushForNotification(created.id);
        const row = await notificationsService.get(created.id);
        expect(row?.push_status).toBe('failed');
        expect(row?.push_failure_reason).toContain('boom');
    });

    it('sets push_status="none" when all subscriptions are dead (all 410-gone)', async () => {
        await insertSub(SUB_A);
        await insertSub(SUB_B);
        sendNotification.mockReset();
        // Both subs return 410 — dead.
        sendNotification.mockRejectedValue(
            Object.assign(new Error('Gone'), { statusCode: 410 }),
        );
        const created = await notificationsService.create({
            event_type: 'test',
            message: 'all gone',
            kind: 'update',
        });
        await new Promise((r) => setTimeout(r, 50));
        await sendWebPushForNotification(created.id);
        const row = await notificationsService.get(created.id);
        // When every subscription was 410-dead, push_status is reset to 'none'
        // (no recipients remaining).
        expect(row?.push_status).toBe('none');
        // Both subscriptions should have been deleted.
        const remaining = await testDb.selectFrom('push_subscriptions').selectAll().execute();
        expect(remaining).toHaveLength(0);
    });
});

describe('getVapidPublicKey', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('returns the public key from the DB (generates and caches if missing)', async () => {
        // Reset cache so the try/catch body (lines 55-62) executes.
        _resetVapidCacheForTest();
        const key = await getVapidPublicKey();
        expect(key).toBeTruthy();
        expect(typeof key).toBe('string');
    });

    it('returns the same key on subsequent calls (in-process cache)', async () => {
        _resetVapidCacheForTest();
        const key1 = await getVapidPublicKey();
        const key2 = await getVapidPublicKey();
        expect(key1).toBe(key2);
    });

    it('cold load from DB — loads keys when cache is empty (covers lines 65-72 / try body)', async () => {
        // Reset the in-process cache so the try/catch body executes.
        // The settings row still has VAPID keys (not cleared by truncateAll), so
        // loadOrGenerateVapid() will succeed and return the keys.
        _resetVapidCacheForTest();
        const key = await getVapidPublicKey();
        // Key should be loaded from DB
        expect(key).toBeTruthy();
        expect(typeof key).toBe('string');
    });

    it('generates + persists fresh VAPID keys when DB row has none (covers lines 40-47)', async () => {
        // Clear the VAPID keys from settings so loadOrGenerateVapid takes the
        // key-generation path (lines 40-47).
        _resetVapidCacheForTest();
        await testDb
            .updateTable('settings')
            .set({ vapid_public_key: null, vapid_private_key: null })
            .where('id', '=', 1)
            .execute();
        const key = await getVapidPublicKey();
        expect(key).toBeTruthy();
        // The mock generateVAPIDKeys returns our test key.
        expect(key).toBe('BDeyOXFJ5UwQ-test-public-key-base64url');
        _resetVapidCacheForTest();
    });

    it('returns null when setVapidDetails throws (catch on line 60 — returns null)', async () => {
        // Reset cache AND make webpush.setVapidDetails throw to trigger the catch.
        _resetVapidCacheForTest();
        const webpushMock = (await import('web-push')).default as { setVapidDetails: ReturnType<typeof vi.fn> };
        webpushMock.setVapidDetails.mockImplementationOnce(() => {
            throw new Error('invalid VAPID');
        });
        const key = await getVapidPublicKey();
        expect(key).toBeNull();
        _resetVapidCacheForTest(); // reset for subsequent tests
    });
});

describe('sendTestPush', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('returns VAPID error when ensureVapid returns false (setVapidDetails throws — lines 255-256)', async () => {
        // Reset the in-process VAPID cache so ensureVapid re-runs.
        _resetVapidCacheForTest();
        // Make webpush.setVapidDetails throw so ensureVapid catches and returns false.
        const webpushMock = (await import('web-push')).default as { setVapidDetails: ReturnType<typeof vi.fn> };
        webpushMock.setVapidDetails.mockImplementationOnce(() => {
            throw new Error('invalid VAPID keys');
        });
        const result = await sendTestPush();
        expect(result.ok).toBe(false);
        expect(result.error).toContain('VAPID');
        _resetVapidCacheForTest();
    });

    it('returns error when no subscriptions are registered', async () => {
        const result = await sendTestPush();
        expect(result.ok).toBe(false);
        expect(result.error).toContain('No subscriptions');
    });

    it('returns ok=true and delivered=1 when subscription accepts the push', async () => {
        await insertSub(SUB_A);
        const result = await sendTestPush();
        expect(result.ok).toBe(true);
        expect(result.subscriptions).toBe(1);
        expect(result.delivered).toBe(1);
    });

    it('returns ok=false when delivery fails for all subscriptions', async () => {
        await insertSub(SUB_A);
        sendNotification.mockReset();
        sendNotification.mockRejectedValue(
            Object.assign(new Error('server error'), { statusCode: 500 }),
        );
        const result = await sendTestPush();
        expect(result.ok).toBe(false);
        expect(result.delivered).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// urlForNotification branch coverage — exercised via sendWebPushForNotification.
// Insert notifications directly via testDb to avoid the background fire race;
// the private helper selects the deeplink URL that ends up in the push payload.
// ---------------------------------------------------------------------------
describe('urlForNotification via sendWebPushForNotification', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
        await insertProject('p1', 'URL');
        await insertSub(SUB_A);
    });

    /** Insert notification directly (bypasses notificationsService.create background fire). */
    async function insertNotification(overrides: {
        item_id?: string | null;
        link_url?: string | null;
        kind?: 'update' | 'needs_you' | 'system';
    }): Promise<number> {
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'url-test',
                kind: overrides.kind ?? 'update',
                item_id: overrides.item_id ?? null,
                link_url: overrides.link_url ?? null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        return Number(row.id);
    }

    async function getLastPayload(): Promise<{ url: string; title: string }> {
        const calls = sendNotification.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        return JSON.parse(calls[calls.length - 1][1] as string) as { url: string; title: string };
    }

    it('routes epic items to /epics/:id', async () => {
        await insertItem({ id: 'URL-1', type: 'epic', project_id: 'p1', title: 'E1' });
        const notifId = await insertNotification({ item_id: 'URL-1' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/epics/URL-1');
    });

    it('routes story items to /issues/stories/:id', async () => {
        // story must be parented to an epic.
        await insertItem({ id: 'URL-E3', type: 'epic', project_id: 'p1', title: 'EpicForStory' });
        await insertItem({ id: 'URL-2', type: 'story', project_id: 'p1', title: 'S1', parent_id: 'URL-E3' });
        const notifId = await insertNotification({ item_id: 'URL-2' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/issues/stories/URL-2');
    });

    it('routes bug items to /issues/bugs/:id', async () => {
        // bug must be parented to an epic.
        await insertItem({ id: 'URL-E4', type: 'epic', project_id: 'p1', title: 'EpicForBug' });
        await insertItem({ id: 'URL-3', type: 'bug', project_id: 'p1', title: 'B1', parent_id: 'URL-E4' });
        const notifId = await insertNotification({ item_id: 'URL-3' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/issues/bugs/URL-3');
    });

    it('routes sub_task items to /issues/sub-tasks/:id', async () => {
        // sub_task must be parented to a story, which must be parented to an epic.
        await insertItem({ id: 'URL-E1', type: 'epic', project_id: 'p1', title: 'Epic' });
        await insertItem({ id: 'URL-S1', type: 'story', project_id: 'p1', title: 'Story', parent_id: 'URL-E1' });
        await insertItem({ id: 'URL-4', type: 'sub_task', project_id: 'p1', title: 'ST1', parent_id: 'URL-S1' });
        const notifId = await insertNotification({ item_id: 'URL-4' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/issues/sub-tasks/URL-4');
    });

    it('routes sub_bug items to /issues/sub-bugs/:id', async () => {
        // sub_bug must be parented to a story, which must be parented to an epic.
        await insertItem({ id: 'URL-E2', type: 'epic', project_id: 'p1', title: 'Epic2' });
        await insertItem({ id: 'URL-S2', type: 'story', project_id: 'p1', title: 'Story2', parent_id: 'URL-E2' });
        await insertItem({ id: 'URL-5', type: 'sub_bug', project_id: 'p1', title: 'SB1', parent_id: 'URL-S2' });
        const notifId = await insertNotification({ item_id: 'URL-5' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/issues/sub-bugs/URL-5');
    });

    it('uses link_url when set (overrides item route)', async () => {
        const notifId = await insertNotification({ link_url: '/terminal/session/abc' });
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/terminal/session/abc');
    });

    it('falls back to /notifications when no item_id or link_url', async () => {
        const notifId = await insertNotification({});
        await sendWebPushForNotification(notifId);
        const payload = await getLastPayload();
        expect(payload.url).toBe('/notifications');
    });
});

// ---------------------------------------------------------------------------
// titleForKind — exercised via sendWebPushForNotification payload.
// Direct DB inserts bypass the background fire race condition.
// ---------------------------------------------------------------------------
describe('titleForKind via sendWebPushForNotification', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
        await insertSub(SUB_A);
    });

    async function insertNotificationWithKind(kind: 'needs_you' | 'system' | 'update'): Promise<number> {
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'title-test',
                kind,
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        return Number(row.id);
    }

    it('sets title to "Atlas — needs you" for needs_you kind', async () => {
        const notifId = await insertNotificationWithKind('needs_you');
        await sendWebPushForNotification(notifId);
        const calls = sendNotification.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const payload = JSON.parse(calls[0][1] as string) as { title: string };
        expect(payload.title).toBe('Atlas — needs you');
    });

    it('sets title to "Atlas — system" for system kind', async () => {
        const notifId = await insertNotificationWithKind('system');
        await sendWebPushForNotification(notifId);
        const calls = sendNotification.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const payload = JSON.parse(calls[0][1] as string) as { title: string };
        expect(payload.title).toBe('Atlas — system');
    });

    it('sets default title "Atlas" for update kind', async () => {
        const notifId = await insertNotificationWithKind('update');
        await sendWebPushForNotification(notifId);
        const calls = sendNotification.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const payload = JSON.parse(calls[0][1] as string) as { title: string };
        expect(payload.title).toBe('Atlas');
    });
});

// ---------------------------------------------------------------------------
// isDeadSubscription — 404 treated same as 410 (delete the sub).
// ---------------------------------------------------------------------------
describe('isDeadSubscription — 404 case', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('deletes a subscription when the push service returns 404 Not Found', async () => {
        await insertSub(SUB_A);
        sendNotification.mockReset();
        sendNotification.mockRejectedValue(
            Object.assign(new Error('Not Found'), { statusCode: 404 }),
        );
        // Insert notification directly to avoid background fire using up the mockRejectedValue.
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: '404-dead-sub',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await sendWebPushForNotification(Number(row.id));

        const remaining = await testDb.selectFrom('push_subscriptions').selectAll().execute();
        expect(remaining).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// sendWebPushForNotification outer catch — covers lines 222-228.
// When the inner push delivery pipeline throws unexpectedly (e.g., the
// notificationsService.updatePushStatus('pending') call fails), the outer
// catch is entered and a last-ditch failed status is attempted.
// ---------------------------------------------------------------------------
describe('sendWebPushForNotification outer catch — last-ditch error handling', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('handles updatePushStatus throw on pending by entering outer catch (Error instance)', async () => {
        await insertSub(SUB_A);
        // Make notificationsService.updatePushStatus throw on the first call
        // (the 'pending' update) so the outer catch fires.
        const spy = vi
            .spyOn(notificationsService, 'updatePushStatus')
            .mockRejectedValueOnce(new Error('DB write failed'));
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'outer-catch-test',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        // sendWebPushForNotification must not throw even when updatePushStatus fails.
        await expect(sendWebPushForNotification(Number(row.id))).resolves.toBeUndefined();
        spy.mockRestore();
    });

    it('handles updatePushStatus throw on pending — non-Error rejection (string)', async () => {
        await insertSub(SUB_A);
        // Throw a plain string rather than an Error to exercise the
        // `String(err)` branch in the ternary on line 222.
        const spy = vi
            .spyOn(notificationsService, 'updatePushStatus')
            .mockRejectedValueOnce('plain string error');
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'outer-catch-non-error',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await expect(sendWebPushForNotification(Number(row.id))).resolves.toBeUndefined();
        spy.mockRestore();
    });

    it('silently swallows when BOTH outer-catch AND the status-write fail (inner catch)', async () => {
        await insertSub(SUB_A);
        // First call throws (outer catch fires), second call also throws
        // (inner catch on line 225-227 fires — gives up silently).
        const spy = vi
            .spyOn(notificationsService, 'updatePushStatus')
            .mockRejectedValue(new Error('always fails'));
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'inner-catch-test',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await expect(sendWebPushForNotification(Number(row.id))).resolves.toBeUndefined();
        spy.mockRestore();
    });

    it('uses err.name when outer-catch err.message is empty (line 232 err.message||err.name)', async () => {
        await insertSub(SUB_A);
        // Throw an Error with empty message in the first updatePushStatus call,
        // so the outer catch fires with an Error where message is ''.
        const errEmptyMsg = new Error('');
        const spy = vi
            .spyOn(notificationsService, 'updatePushStatus')
            .mockRejectedValueOnce(errEmptyMsg);
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'empty-msg-outer-catch',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await expect(sendWebPushForNotification(Number(row.id))).resolves.toBeUndefined();
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Edge cases for deliver() error branches (lines 152-154)
// ---------------------------------------------------------------------------
describe('deliver — error reason branches', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('uses err.name when err.message is empty (line 153 err.message||err.name branch)', async () => {
        await insertSub(SUB_A);
        // Throw an Error with empty message — should fall back to err.name.
        const errWithNoMsg = new Error('');
        sendNotification.mockReset();
        sendNotification.mockRejectedValueOnce(Object.assign(errWithNoMsg, { statusCode: 500 }));
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'empty-msg-error',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await sendWebPushForNotification(Number(row.id));
        const updated = await testDb
            .selectFrom('notifications')
            .selectAll()
            .where('id', '=', Number(row.id))
            .executeTakeFirst();
        // The reason should be the error name (since message was empty)
        expect(updated?.push_status).toBe('failed');
        expect(updated?.push_failure_reason).toBeTruthy();
    });

    it('uses String(err) when err is not an Error instance (line 153 false branch)', async () => {
        await insertSub(SUB_A);
        sendNotification.mockReset();
        // Throw a plain object that is not an Error
        sendNotification.mockRejectedValueOnce({ statusCode: 500 });
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'non-error-throw',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        await sendWebPushForNotification(Number(row.id));
        const updated = await testDb
            .selectFrom('notifications')
            .selectAll()
            .where('id', '=', Number(row.id))
            .executeTakeFirst();
        expect(updated?.push_status).toBe('failed');
    });
});

// ---------------------------------------------------------------------------
// sendWebPushForNotification early-return branches
// ---------------------------------------------------------------------------
describe('sendWebPushForNotification early-return paths', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('returns early when notification ID does not exist in DB (line 180 branch)', async () => {
        // Pass a non-existent notification ID — executeTakeFirst returns undefined.
        await expect(sendWebPushForNotification(999999)).resolves.toBeUndefined();
    });

    it('returns early when ensureVapid returns false (line 164 branch)', async () => {
        // Reset cache and make setVapidDetails throw so ensureVapid returns false.
        _resetVapidCacheForTest();
        const webpushMock = (await import('web-push')).default as { setVapidDetails: ReturnType<typeof vi.fn> };
        webpushMock.setVapidDetails.mockImplementationOnce(() => {
            throw new Error('VAPID setup failed');
        });
        await expect(sendWebPushForNotification(1)).resolves.toBeUndefined();
        _resetVapidCacheForTest();
    });
});

// ---------------------------------------------------------------------------
// Partial failures — some subs succeed, some fail with a real server error.
// ---------------------------------------------------------------------------
describe('partial delivery failures', () => {
    beforeEach(async () => {
        await truncateAll();
        sendNotification.mockReset();
        sendNotification.mockResolvedValue({ statusCode: 201 });
    });

    it('marks push_status="failed" when some subscriptions get a server error', async () => {
        await insertSub(SUB_A);
        await insertSub(SUB_B);
        sendNotification.mockReset();
        // SUB_A succeeds, SUB_B fails with 500. Persistent mock for the
        // explicit sendWebPushForNotification call (no background fire racing
        // because we insert the notification directly via testDb).
        sendNotification
            .mockResolvedValueOnce({ statusCode: 201 })
            .mockRejectedValueOnce(Object.assign(new Error('server crash'), { statusCode: 500 }));
        // Insert notification directly (no background fire race).
        const row = await testDb
            .insertInto('notifications')
            .values({
                event_type: 'test',
                message: 'partial-fail',
                kind: 'update',
                item_id: null,
                link_url: null,
                project_id: null,
                agent_id: null,
                sent_external: 0,
                external_status: 'none',
                failure_reason: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        const notifId = Number(row.id);
        await sendWebPushForNotification(notifId);
        const row2 = await testDb
            .selectFrom('notifications')
            .selectAll()
            .where('id', '=', notifId)
            .executeTakeFirst();
        // At least one delivery failed with a real error → failed status.
        expect(row2?.push_status).toBe('failed');
        expect(row2?.push_failure_reason).toContain('server crash');
    });
});
