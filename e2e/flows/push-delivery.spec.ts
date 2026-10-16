import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost, chainGraph, createTask, createWorkflow } from '../helpers/api.js';
import { sql } from '../helpers/db.js';

// Web push end to end, short of Google's push service: the API's real
// `web-push` send (VAPID + aes128gcm) lands on a local push endpoint, which
// decrypts it with the subscription's private key exactly as a browser's push
// service hands it to the browser (RFC 8291). The decrypted payload is then
// delivered to the real service worker over CDP, which must show the OS
// notification. The producer is a real workflow park.

const PUSH_PORT = 6094;
const ENDPOINT = `https://127.0.0.1:${PUSH_PORT}/push/e2e-device`;
// Written by global-setup, which also makes the API trust it.
const TLS = new URL('../../e2e-logs/push-tls/', import.meta.url).pathname;

interface Received {
    headers: Record<string, string | string[] | undefined>;
    payload: { title: string; body: string; kind: string; url: string; notification_id: number };
}

const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);
let received: Received[] = [];
let server: Server;

/** RFC 8291 / 8188 aes128gcm, one record. */
function decrypt(body: Buffer): string {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const secret = ua.computeSecret(asPublic);
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, keyInfo, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
    // Padding: the last record ends with 0x02 then zeros.
    return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });
// The default headless shell has no notification permission at all; full
// Chromium in new-headless mode grants it.
test.use({ channel: 'chromium' });

test.beforeAll(async ({ request }) => {
    server = createServer({ key: readFileSync(`${TLS}key.pem`), cert: readFileSync(`${TLS}cert.pem`) }, (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            received.push({ headers: req.headers, payload: JSON.parse(decrypt(Buffer.concat(chunks))) as Received['payload'] });
            res.writeHead(201);
            res.end();
        });
    });
    await new Promise<void>((r) => server.listen(PUSH_PORT, '127.0.0.1', () => r()));
    const sub = await request.post(`${API}/api/push-subscriptions/subscribe`, {
        data: {
            endpoint: ENDPOINT,
            p256dh: ua.getPublicKey().toString('base64url'),
            auth: auth.toString('base64url'),
            userAgent: 'Playwright/push-delivery',
        },
    });
    expect(sub.status(), await sub.text()).toBe(201);
});

test.beforeEach(async ({ request }) => {
    received = [];
    sql('DELETE FROM notifications');
    await settings(request, { external_notification_event_toggles: {}, quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00' });
});

test.afterAll(async ({ request }) => {
    await request.post(`${API}/api/push-subscriptions/unsubscribe`, { data: { endpoint: ENDPOINT } });
    await settings(request, { external_notification_event_toggles: {}, quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00' });
    server.close();
});

async function settings(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
    const res = await request.patch(`${API}/api/settings/notifications`, { data });
    expect(res.status(), await res.text()).toBeLessThan(300);
}

/** A real producer: a workflow whose only step is the Owner parks its Task. */
async function park(request: APIRequestContext, name: string): Promise<string> {
    const wf = await createWorkflow(request, name, chainGraph({ type: 'owner' }));
    const task = await createTask(request, `${name} task`);
    const queued = await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
    expect(queued.status(), await queued.text()).toBeLessThan(300);
    await apiPost(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });
    return task.id;
}

const pushRow = async (request: APIRequestContext, taskId: string) =>
    (await apiGet<Array<{ issue_id: string | null; push_status: string; event_type: string }>>(request, '/api/notifications?limit=50')).find(
        (n) => n.issue_id === taskId && n.event_type === 'workflow_run',
    );

test('a park is pushed: VAPID-signed, aes128gcm-encrypted, the payload opens its run page', async ({ request }) => {
    const taskId = await park(request, `E2E push ${Date.now()}`);
    await expect.poll(() => received.length, { timeout: 30_000 }).toBe(1);
    const [{ headers, payload }] = received as [Received];
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(String(headers['authorization'])).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(Number(headers['ttl'])).toBeGreaterThan(0);
    expect(payload).toMatchObject({ title: expect.any(String), kind: 'needs_you' });
    expect(payload.body).toContain(`needs you on ${taskId}`);
    expect(payload.url).toMatch(/^\/workflows\/[^/]+\/runs\/[^/]+$/);
    await expect.poll(async () => (await pushRow(request, taskId))?.push_status).toBe('sent');
});

test.describe('in the browser', () => {
    test('the service worker turns the pushed payload into an OS notification', async ({ page, context, request }) => {
        const taskId = await park(request, `E2E sw ${Date.now()}`);
        await expect.poll(() => received.length, { timeout: 30_000 }).toBe(1);
        const { payload } = received[0]!;

        await context.grantPermissions(['notifications']);
        await goto(page, '/');
        const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
        expect(await page.evaluate(() => Notification.permission)).toBe('granted');
        // Headless Chrome shows notifications without listing them, so record
        // what the real sw.js push handler asks for (and still show it).
        const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        await sw.evaluate(() => {
            const g = self as unknown as { __shown: unknown[] };
            g.__shown = [];
            const proto = ServiceWorkerRegistration.prototype;
            const show = proto.showNotification;
            proto.showNotification = function (title: string, options?: NotificationOptions) {
                g.__shown.push({ title, options });
                return show.call(this, title, options);
            };
        });

        const cdp = await context.newCDPSession(page);
        const registered = new Promise<string>((resolve) => {
            cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: Array<{ registrationId: string; scopeURL: string }> }) => {
                const r = e.registrations.find((x) => x.scopeURL === scope);
                if (r) resolve(r.registrationId);
            });
        });
        await cdp.send('ServiceWorker.enable');
        await cdp.send('ServiceWorker.deliverPushMessage', {
            origin: new URL(scope).origin,
            registrationId: await registered,
            data: JSON.stringify(payload),
        });

        await expect
            .poll(() => sw.evaluate(() => (self as unknown as { __shown: unknown[] }).__shown))
            .toEqual([
                {
                    title: payload.title,
                    options: {
                        body: payload.body,
                        icon: '/atlas.png',
                        badge: '/atlas.png',
                        tag: String(payload.notification_id),
                        data: { url: payload.url, notification_id: payload.notification_id, kind: 'needs_you' },
                        requireInteraction: true,
                    },
                },
            ]);
        expect(payload.body).toContain(taskId);
    });
});

test('a switched-off event is not pushed', async ({ request }) => {
    await settings(request, { external_notification_event_toggles: { 'item.status_changed:waiting_for_info': false } });
    const taskId = await park(request, `E2E push off ${Date.now()}`);
    await expect.poll(async () => (await pushRow(request, taskId)) !== undefined, { timeout: 30_000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(received).toHaveLength(0);
    expect((await pushRow(request, taskId))?.push_status).toBe('none');
});

test('inside quiet hours the push is held, then sent once by the minute tick after the window ends', async ({ request }) => {
    const h = new Date().getUTCHours();
    const hh = (n: number) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
    await settings(request, { quiet_hours_enabled: 1, quiet_hours_from: hh(h - 1), quiet_hours_to: hh(h + 2), quiet_hours_timezone: 'UTC' });
    const taskId = await park(request, `E2E push quiet ${Date.now()}`);
    await expect.poll(async () => (await pushRow(request, taskId))?.push_status, { timeout: 30_000 }).toBe('pending');
    await new Promise((r) => setTimeout(r, 3_000));
    expect(received).toHaveLength(0);

    // Window over: the next minute tick flushes the held push exactly once.
    await settings(request, { quiet_hours_enabled: 0 });
    await expect.poll(() => received.length, { timeout: 75_000, intervals: [2_000] }).toBe(1);
    expect(received[0]!.payload.body).toContain(taskId);
    await expect.poll(async () => (await pushRow(request, taskId))?.push_status).toBe('sent');
    await new Promise((r) => setTimeout(r, 2_000));
    expect(received).toHaveLength(1);
});
