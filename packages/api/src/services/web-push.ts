import webpush, { type PushSubscription, type WebPushError } from 'web-push';
import { db } from '../db/kysely-client.js';
import { notificationsService } from './notifications.js';
import { encrypt, decrypt } from './crypto.js';
import type { IssueType } from '@atlas/shared';

// VAPID keys are persisted in the `settings` singleton row. The FIRST call
// that needs them generates a fresh keypair and writes it back; every
// subsequent call (this process or any other) reads what's already there.
// This keeps the keys stable across restarts (rotating them would invalidate
// every active browser subscription) without making the Owner run a script.
//
// `vapidSubject` is a mailto: URL the browser's push service contacts in
// case of abuse — `mailto:atlas@local` is fine for single-owner local use;
// no Owner-facing config surface needed.
const VAPID_SUBJECT = 'mailto:atlas@local';

// In-process cache: once we've loaded + bound the keys for this Node
// process, skip the DB roundtrip on subsequent publish calls.
let cachedPublicKey: string | null = null;

/**
 * Test-only helper. Clears the in-process VAPID key cache so that the next
 * call to `getVapidPublicKey` / `ensureVapid` re-reads from the DB. Never
 * call in production code.
 * @internal
 */
export function _resetVapidCacheForTest(): void {
    cachedPublicKey = null;
}

// The private key ciphertext (AES-256-GCM via services/crypto.ts) is always
// prefixed with an ASCII marker so we can distinguish an encrypted blob from
// a legacy plaintext key that was persisted before this change. Any row
// missing the prefix is treated as legacy plaintext and re-encrypted the
// next time it's read.
const VAPID_PRIV_PREFIX = 'v1:';

function decryptVapidPrivateKey(stored: string): string {
    if (stored.startsWith(VAPID_PRIV_PREFIX)) {
        return decrypt(stored.slice(VAPID_PRIV_PREFIX.length));
    }
    // Legacy plaintext value written before at-rest encryption. Return the
    // raw string; the caller will re-encrypt on the next write path.
    return stored;
}

function encryptVapidPrivateKey(plain: string): string {
    return VAPID_PRIV_PREFIX + encrypt(plain);
}

async function loadOrGenerateVapid(): Promise<{ publicKey: string; privateKey: string }> {
    const row = await db
        .selectFrom('settings')
        .select(['vapid_public_key', 'vapid_private_key'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
    if (row.vapid_public_key && row.vapid_private_key) {
        const privateKey = decryptVapidPrivateKey(row.vapid_private_key);
        // If the stored value was legacy plaintext, upgrade it in place so
        // a DB dump never re-exposes the private key. Fire-and-forget — a
        // subsequent read finds the encrypted form.
        if (!row.vapid_private_key.startsWith(VAPID_PRIV_PREFIX)) {
            await db
                .updateTable('settings')
                .set({ vapid_private_key: encryptVapidPrivateKey(privateKey) })
                .where('id', '=', 1)
                .execute();
        }
        return { publicKey: row.vapid_public_key, privateKey };
    }
    const fresh = webpush.generateVAPIDKeys();
    await db
        .updateTable('settings')
        .set({
            vapid_public_key: fresh.publicKey,
            vapid_private_key: encryptVapidPrivateKey(fresh.privateKey),
        })
        .where('id', '=', 1)
        .execute();
    return fresh;
}

async function ensureVapid(): Promise<boolean> {
    if (cachedPublicKey) return true;
    try {
        const { publicKey, privateKey } = await loadOrGenerateVapid();
        webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
        cachedPublicKey = publicKey;
        return true;
    } catch {
        // Settings row missing or DB unreachable — silently no-op. The
        // in-app feed already broadcasted via SSE.
        return false;
    }
}

export async function getVapidPublicKey(): Promise<string | null> {
    if (cachedPublicKey) return cachedPublicKey;
    try {
        const { publicKey, privateKey } = await loadOrGenerateVapid();
        webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
        cachedPublicKey = publicKey;
        return publicKey;
    } catch {
        return null;
    }
}

// The browser sends back a click URL routing the user to the originating item.
// Mirrors the navigation logic in InAppFeedTabContent so a click in either
// surface lands on the same place.
function urlForNotification(row: {
    item_id: string | null;
    item_type: IssueType | null;
    project_id: string | null;
    link_url: string | null;
}): string {
    // Explicit per-notification deep link wins (Terminal sessions and
    // any future non-item-shaped surface use this).
    if (row.link_url) return row.link_url;
    if (row.item_id && row.item_type) {
        switch (row.item_type) {
            case 'epic':
                return `/epics/${row.item_id}`;
            case 'story':
                return `/issues/stories/${row.item_id}`;
            case 'bug':
                return `/issues/bugs/${row.item_id}`;
            case 'sub_task':
                return `/issues/sub-tasks/${row.item_id}`;
            case 'sub_bug':
                return `/issues/sub-bugs/${row.item_id}`;
        }
    }
    return '/notifications';
}

interface PushPayload {
    title: string;
    body: string;
    kind: string;
    url: string;
    notification_id: number;
}

// 404 / 410 from the browser's push service means the subscription is
// permanently gone — the user uninstalled the PWA, cleared site data,
// revoked permission, or the endpoint expired. We delete the row so the
// next publish doesn't retry against a dead endpoint.
function isDeadSubscription(err: unknown): boolean {
    const status = (err as WebPushError | undefined)?.statusCode;
    return status === 404 || status === 410;
}

async function deleteSubscription(endpoint: string): Promise<void> {
    await db.deleteFrom('push_subscriptions').where('endpoint', '=', endpoint).execute();
}

interface SubscriptionRow {
    endpoint: string;
    p256dh: string;
    auth: string;
}

function toPushSubscription(row: SubscriptionRow): PushSubscription {
    return {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
    };
}

async function deliver(
    sub: SubscriptionRow,
    payload: PushPayload,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
        await webpush.sendNotification(toPushSubscription(sub), JSON.stringify(payload), {
            TTL: 60 * 60 * 24, // 1 day — push services drop after this window
        });
        return { ok: true };
    } catch (err) {
        if (isDeadSubscription(err)) {
            await deleteSubscription(sub.endpoint);
            return { ok: false, reason: 'subscription_gone' };
        }
        const reason =
            err instanceof Error ? (err.message || err.name) : String(err);
        return { ok: false, reason };
    }
}

/**
 * Fan out a freshly-created notification to every registered push subscription.
 * Called from notificationsService.create() as a fire-and-forget side effect.
 * Internal errors are caught here — this function never throws.
 */
export async function sendWebPushForNotification(notificationId: number): Promise<void> {
    if (!(await ensureVapid())) return;
    try {
        const notification = await db
            .selectFrom('notifications as n')
            .leftJoin('items as i', 'i.id', 'n.item_id')
            .select([
                'n.id as id',
                'n.message as message',
                'n.kind as kind',
                'n.item_id as item_id',
                'n.project_id as project_id',
                'n.link_url as link_url',
                'i.type as item_type',
            ])
            .where('n.id', '=', notificationId)
            .executeTakeFirst();
        if (!notification) return;

        const subs = (await db
            .selectFrom('push_subscriptions')
            .select(['endpoint', 'p256dh', 'auth'])
            .execute()) as SubscriptionRow[];

        if (subs.length === 0) {
            // Leave push_status='none' — the row hasn't been targeted at anyone.
            return;
        }

        await notificationsService.updatePushStatus(notificationId, 'pending');

        const payload: PushPayload = {
            title: titleForKind(notification.kind as string),
            body: notification.message as string,
            kind: notification.kind as string,
            url: urlForNotification({
                item_id: (notification.item_id as string | null) ?? null,
                item_type: (notification.item_type as IssueType | null) ?? null,
                project_id: (notification.project_id as string | null) ?? null,
                link_url: (notification.link_url as string | null) ?? null,
            }),
            notification_id: Number(notification.id),
        };

        const results = await Promise.all(subs.map((s) => deliver(s, payload)));
        const failures = results.filter(
            (r): r is { ok: false; reason: string } =>
                !r.ok && r.reason !== 'subscription_gone',
        );
        const aliveResults = results.filter((r) =>
            r.ok ? true : r.reason !== 'subscription_gone',
        );

        if (aliveResults.length === 0) {
            // Every subscription was 410-gone and just deleted itself. Treat as
            // "no recipients" rather than failure — there's nothing to retry.
            await notificationsService.updatePushStatus(notificationId, 'none');
            return;
        }

        if (failures.length === 0) {
            await notificationsService.updatePushStatus(notificationId, 'sent');
        } else {
            const reason = failures.map((f) => f.reason).join('; ');
            await notificationsService.updatePushStatus(notificationId, 'failed', reason);
        }
    } catch (err) {
        // Last-ditch: never propagate from here. The in-app feed already saw
        // the notification via SSE; a logged warning is enough.
        const reason = err instanceof Error ? (err.message || err.name) : String(err);
        try {
            await notificationsService.updatePushStatus(notificationId, 'failed', reason);
        } catch {
            // Even the status write failed — give up silently.
        }
    }
}

function titleForKind(kind: string): string {
    switch (kind) {
        case 'needs_you':
            return 'Atlas — needs you';
        case 'system':
            return 'Atlas — system';
        case 'update':
        default:
            return 'Atlas';
    }
}

/**
 * Send a one-shot test notification to every registered subscription.
 * Used by the "Send test" link in ProfileTab to confirm the SW + VAPID
 * + browser permission chain end-to-end without waiting for a real event.
 */
export async function sendTestPush(): Promise<{
    ok: boolean;
    subscriptions: number;
    delivered: number;
    error?: string;
}> {
    if (!(await ensureVapid())) {
        return { ok: false, subscriptions: 0, delivered: 0, error: 'VAPID keys not configured' };
    }
    const subs = (await db
        .selectFrom('push_subscriptions')
        .select(['endpoint', 'p256dh', 'auth'])
        .execute()) as SubscriptionRow[];
    if (subs.length === 0) {
        return { ok: false, subscriptions: 0, delivered: 0, error: 'No subscriptions registered' };
    }
    const payload: PushPayload = {
        title: 'Atlas — test push',
        body: 'If you see this, web push is wired up correctly.',
        kind: 'system',
        url: '/notifications',
        notification_id: 0,
    };
    const results = await Promise.all(subs.map((s) => deliver(s, payload)));
    const delivered = results.filter((r) => r.ok).length;
    return { ok: delivered > 0, subscriptions: subs.length, delivered };
}
