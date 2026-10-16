import { createServer, type Server } from 'node:http';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, FAKE_TELEGRAM_PORT, apiGet, apiPost, chainGraph, createTask, createWorkflow } from '../helpers/api.js';

// Quiet hours against the REAL clock: the e2e API's own minute tick (no fake
// timers) holds sends during a window that ends a minute or two from now,
// then delivers them when it ends. The external channel is a local HTTP
// receiver: Teams is a plain POST to a webhook URL, and the API's Telegram
// base URL is already pointed here (ATLAS_TELEGRAM_API_BASE in
// global-setup.ts), so both transports run end to end for real.
//
// Each window costs ~2–3 minutes of wall clock, so this spec only runs under
// `pnpm e2e:live` (E2E_LIVE=1); the default `pnpm e2e` skips it.

test.skip(process.env['E2E_LIVE'] !== '1', 'live-clock spec: run with `pnpm e2e:live`');

interface Received {
    path: string;
    body: Record<string, unknown>;
}

let receiver: Server;
let received: Received[] = [];
const STAMP = Date.now();
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

test.beforeAll(async () => {
    receiver = createServer((req, res) => {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
            if (req.method === 'POST') received.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : {} });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: {} }));
        });
    });
    await new Promise<void>((r) => receiver.listen(FAKE_TELEGRAM_PORT, '127.0.0.1', () => r()));
});

test.afterAll(async ({ request }) => {
    receiver.close();
    await request.patch(`${API}/api/settings/external-notification`, {
        data: {
            external_notification_provider: 'telegram',
            external_notification_token: null,
            external_notification_chat_id: null,
            external_notification_webhook_url: null,
        },
    });
    await request.patch(`${API}/api/settings/notifications`, {
        data: { quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00', external_notification_event_toggles: {} },
    });
});

const hhmm = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE }).format(new Date(ms));

/**
 * A window that started two minutes before `fireAt` (the next minute
 * boundary with at least 20s to set up) and ends one minute after it. The
 * tick at `fireAt` fires the reminder (held); the tick at `endsAt` flushes.
 */
async function openWindow(request: APIRequestContext) {
    let fireAt = Math.ceil(Date.now() / 60_000) * 60_000;
    if (fireAt - Date.now() < 20_000) fireAt += 60_000;
    const endsAt = fireAt + 60_000;
    const res = await request.patch(`${API}/api/settings/notifications`, {
        data: {
            quiet_hours_enabled: 1,
            quiet_hours_from: hhmm(fireAt - 120_000),
            quiet_hours_to: hhmm(endsAt),
            quiet_hours_timezone: ZONE,
            external_notification_event_toggles: {},
        },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
    return { fireAt, endsAt };
}

function externalReminder(request: APIRequestContext, label: string, at: number) {
    return apiPost<{ id: number }>(request, '/api/reminders', {
        label,
        body: 'live clock',
        schedule: { kind: 'once', at: new Date(at).toISOString() },
        channel: 'external',
    });
}

function mcpSend(request: APIRequestContext, message: string, event_key?: string) {
    return apiPost<{ sent: boolean; held: boolean; notification_id: number; external_status: string }>(
        request,
        '/api/notifications/send-external',
        { message, ...(event_key ? { event_key } : {}) },
    );
}

interface IRow {
    id: number;
    event_type: string;
    message: string;
    external_status: string;
    external_deferred_at: string | null;
    failure_reason: string | null;
    in_app: boolean;
    reminder_id: number | null;
}
const rows = (request: APIRequestContext) => apiGet<IRow[]>(request, '/api/notifications?limit=200');
const rowFor = async (request: APIRequestContext, text: string) => (await rows(request)).find((r) => r.message.includes(text));

/** The Notification Log row (desktop grid line) holding `text`. */
const logRow = (page: Page, text: string) =>
    page.locator('div').filter({ has: page.getByText(text, { exact: false }) }).filter({ has: page.getByRole('button') }).last();

const cardTexts = (path: string) =>
    received.filter((r) => r.path === path).map((r) => {
        const body = r.body as { type?: string; version?: string; body?: Array<{ type: string; text: string; wrap: boolean }> };
        expect(body).toMatchObject({ type: 'AdaptiveCard', version: '1.4' });
        expect(body.body).toHaveLength(1);
        expect(body.body?.[0]).toMatchObject({ type: 'TextBlock', wrap: true });
        return body.body?.[0]?.text ?? '';
    });

test.describe('@live quiet hours on the real clock', () => {
    test.describe.configure({ timeout: 6 * 60_000 });

    test('Teams: a reminder, a workflow failure and an MCP send are held, then sent once each when the window ends; one turned off while held is skipped', async ({ page, request }) => {
        received = [];
        const hook = '/teams-live';
        const set = await request.patch(`${API}/api/settings/external-notification`, {
            data: { external_notification_provider: 'teams', external_notification_webhook_url: `http://127.0.0.1:${FAKE_TELEGRAM_PORT}${hook}` },
        });
        expect(set.status(), await set.text()).toBeLessThan(300);

        const { fireAt, endsAt } = await openWindow(request);
        const reminderLabel = `E2E live reminder ${STAMP}`;
        const reminder = await externalReminder(request, reminderLabel, fireAt);

        // A workflow whose only step is a failing check parks as failed → `workflow.failed`.
        const wfName = `E2E live failing ${STAMP}`;
        const wf = await createWorkflow(request, wfName, chainGraph({ type: 'script', label: 'Always fails', command: 'exit 1' }));
        const task = await createTask(request, `E2E live task ${STAMP}`);
        const queued = await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
        expect(queued.status(), await queued.text()).toBeLessThan(300);
        await apiPost(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });

        // MCP sends: one stays on, one has its toggle turned off while held.
        const mcpText = `E2E live digest ${STAMP}`;
        const mcpOffText = `E2E live digest turned off ${STAMP}`;
        expect(await mcpSend(request, mcpText)).toMatchObject({ sent: false, held: true, external_status: 'pending' });
        expect(await mcpSend(request, mcpOffText, 'e2e.live-digest')).toMatchObject({ held: true });

        // Held while the window is open — including the reminder, fired by the real tick.
        await expect.poll(async () => (await rowFor(request, wfName))?.external_deferred_at ?? null, { timeout: 60_000 }).not.toBeNull();
        await expect
            .poll(async () => (await rowFor(request, reminderLabel))?.external_status ?? 'not fired', { timeout: fireAt - Date.now() + 45_000, intervals: [2_000] })
            .toBe('pending');
        expect(received).toHaveLength(0);
        await request.patch(`${API}/api/settings/notifications`, {
            data: { external_notification_event_toggles: { 'e2e.live-digest': false } },
        });

        await goto(page, '/notifications');
        for (const text of [reminderLabel, wfName, mcpText, mcpOffText]) {
            await expect(logRow(page, text).getByText('Held · quiet hours')).toBeVisible();
        }
        // Log-only rows stay out of the feed: the external-only reminder and the MCP sends.
        await page.getByRole('tab', { name: 'In-App Feed' }).click();
        await expect(page.getByText(wfName).first()).toBeVisible();
        await expect(page.getByText(reminderLabel)).toHaveCount(0);
        await expect(page.getByText(mcpText)).toHaveCount(0);
        await page.getByRole('tab', { name: 'Notification Log' }).click();

        // The window ends: the next real tick sends them.
        await expect
            .poll(async () => cardTexts(hook).length, { timeout: endsAt - Date.now() + 45_000, intervals: [2_000] })
            .toBeGreaterThanOrEqual(3);
        await page.waitForTimeout(3_000);
        const texts = cardTexts(hook);
        const prefix = /^Held during quiet hours · \d\d:\d\d\n/;
        const one = (needle: string) => {
            const hits = texts.filter((t) => t.includes(needle));
            expect(hits, `exactly one POST for "${needle}"`).toHaveLength(1);
            expect(hits[0]).toMatch(prefix);
            return hits[0]!;
        };
        expect(one(reminderLabel)).toMatch(new RegExp(`\\n${reminderLabel}: live clock$`));
        expect(one(wfName)).toContain(`${wfName} needs you on ${task.id}`);
        expect(one(mcpText)).toMatch(new RegExp(`\\n${mcpText}$`));
        expect(texts.filter((t) => t.includes(mcpOffText))).toHaveLength(0);
        // eslint-disable-next-line no-console
        console.log('[live] Teams webhook received:', JSON.stringify(received.filter((r) => r.path === hook), null, 1));

        for (const text of [reminderLabel, wfName, mcpText]) {
            await expect(logRow(page, text).getByText('Sent', { exact: true })).toBeVisible({ timeout: 15_000 });
        }
        const skipped = logRow(page, mcpOffText);
        await expect(skipped.getByText('Skipped', { exact: true })).toBeVisible();
        await expect(skipped.getByText('Skipped: event turned off while held')).toBeVisible();
        await expect(skipped.getByRole('button', { name: 'Send now' })).toBeVisible();
        await page.screenshot({ path: 'test-results/live-quiet-hours-teams-log.png', fullPage: true });

        // The reminder's fire log still links its (log-only) row.
        const fires = await apiGet<Array<{ external_status: string }>>(request, `/api/reminders/${reminder.id}/fires`);
        expect(fires.map((f) => f.external_status)).toEqual(['sent']);
        expect(await rowFor(request, reminderLabel)).toMatchObject({ in_app: false, reminder_id: reminder.id });
    });

    test('Telegram: a held reminder and MCP send go out through the Bot API once the window ends', async ({ request }) => {
        received = [];
        const set = await request.patch(`${API}/api/settings/external-notification`, {
            data: { external_notification_provider: 'telegram', external_notification_token: 'live-token', external_notification_chat_id: '42' },
        });
        expect(set.status(), await set.text()).toBeLessThan(300);

        const { fireAt, endsAt } = await openWindow(request);
        const reminderLabel = `E2E live tg reminder ${STAMP}`;
        await externalReminder(request, reminderLabel, fireAt);
        const mcpText = `E2E live tg digest ${STAMP}`;
        expect(await mcpSend(request, mcpText)).toMatchObject({ held: true });

        await expect
            .poll(async () => (await rowFor(request, reminderLabel))?.external_status ?? 'not fired', { timeout: fireAt - Date.now() + 45_000, intervals: [2_000] })
            .toBe('pending');
        expect(received).toHaveLength(0);

        const path = '/botlive-token/sendMessage';
        await expect
            .poll(() => received.filter((r) => r.path === path).length, { timeout: endsAt - Date.now() + 45_000, intervals: [2_000] })
            .toBeGreaterThanOrEqual(2);
        const bodies = received.filter((r) => r.path === path).map((r) => r.body as { chat_id: string; text: string; parse_mode?: string });
        for (const needle of [reminderLabel, mcpText]) {
            const hits = bodies.filter((b) => b.text.includes(needle));
            expect(hits).toHaveLength(1);
            // Plain text: Telegram's Markdown parser 400'd unbalanced `_` / `*` / `[`.
            expect(hits[0]).toMatchObject({ chat_id: '42' });
            expect(hits[0]!.parse_mode).toBeUndefined();
            expect(hits[0]!.text).toMatch(/^Held during quiet hours · \d\d:\d\d\n/);
        }
        // eslint-disable-next-line no-console
        console.log('[live] Telegram Bot API received:', JSON.stringify(received, null, 1));
        await expect.poll(async () => (await rowFor(request, mcpText))?.external_status).toBe('sent');
        await expect.poll(async () => (await rowFor(request, reminderLabel))?.external_status).toBe('sent');
    });
});
