import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, FAKE_TELEGRAM_PORT } from '../helpers/api.js';
import { EXTERNAL_NOTIFICATION_EVENT_KEYS, EXTERNAL_NOTIFICATION_EVENT_LABELS } from '../../packages/shared/src/types/index.js';

// Settings → Notifications without sending anything: event toggles persist,
// quiet hours save and refuse a bad time visibly, idle threshold bounds.

type S = { quiet_hours_enabled: number; quiet_hours_from: string | null; terminal_idle_notify_seconds: number; external_notification_event_toggles: string };
const settings = (request: import('@playwright/test').APIRequestContext) => apiGet<S>(request, '/api/settings');

// A fake Telegram Bot API (ATLAS_TELEGRAM_API_BASE points here) plus two
// Teams webhooks, one that accepts and one that fails.
let fake: Server;
let sent: { token: string; body: string }[] = [];
test.beforeAll(async () => {
    fake = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            const send = (status: number, json: unknown) => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(json));
            };
            const m = /^\/bot([^/]+)\/(sendMessage|getMe)/.exec(req.url ?? '');
            if (m) {
                if (m[1] === 'bad') return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
                if (m[2] === 'getMe') return send(200, { ok: true, result: { username: 'e2e_fake_bot' } });
                sent.push({ token: m[1]!, body });
                return send(200, { ok: true, result: {} });
            }
            if (req.url === '/teams-ok') return send(200, {});
            if (req.url === '/teams-fail') return send(500, { error: 'boom' });
            send(404, {});
        });
    });
    await new Promise<void>((r) => fake.listen(FAKE_TELEGRAM_PORT, '127.0.0.1', () => r()));
});

test.afterAll(async ({ request }) => {
    fake.close();
    await request.patch(`${API}/api/settings/external-notification`, {
        data: { external_notification_provider: 'telegram', external_notification_chat_id: null, external_notification_token: null, external_notification_webhook_url: null },
    });
    await request.patch(`${API}/api/settings/notifications`, {
        data: { quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00', quiet_hours_timezone: 'UTC', terminal_idle_notify_seconds: 300, external_notification_event_toggles: {} },
    });
});

test('event toggle, quiet hours and idle threshold persist; a bad time is refused visibly', async ({ page, request }) => {
    await goto(page, '/settings?tab=notifications');

    const first = page.locator('input[type="checkbox"]').first();
    const was = await first.isChecked();
    await first.click();
    await expect.poll(async () => (await settings(request)).external_notification_event_toggles).not.toBe('{}');
    await page.reload();
    await expect(page.locator('input[type="checkbox"]').first()).toBeChecked({ checked: !was });

    const quiet = page.getByText(/Off — external notifications|External notifications are muted/).locator('..').locator('input[type=checkbox]');
    if (!(await quiet.isChecked())) await quiet.click();
    const from = page.getByLabel('Quiet hours from');
    await expect(from).toBeEnabled();
    await from.fill('23:15');
    await from.blur();
    await expect.poll(async () => (await settings(request)).quiet_hours_from).toBe('23:15');
    await from.fill('25:99');
    await from.blur();
    await expect(page.getByText('Quiet hours not saved')).toBeVisible();
    await expect(from).toHaveValue('23:15');

    const idle = page.locator('input[type="number"]').last();
    await idle.fill('61');
    await idle.blur();
    await expect(idle).toHaveValue('5');
    await idle.fill('10');
    await idle.blur();
    await expect.poll(async () => (await settings(request)).terminal_idle_notify_seconds).toBe(600);
});

const tokenField = (page: import('@playwright/test').Page) => page.getByPlaceholder(/123456789|Stored/).first();
const pill = (page: import('@playwright/test').Page) => page.getByText(/Connected ·|Not connected|Untested/).first();

test('Telegram: save, Send Test, a bad token, the eye, reveal and a Chat ID edit', async ({ page, request }) => {
    sent = [];
    await goto(page, '/settings?tab=notifications', { allow: [/400 \(Bad Request\)/] });

    // Save a token + chat ID and send a real (fake-server) test message.
    await tokenField(page).fill('good-token');
    await page.getByPlaceholder(/-100/).fill('42');
    await page.getByPlaceholder(/-100/).blur();
    await expect.poll(async () => (await apiGet<{ external_notification_token_set: boolean }>(request, '/api/settings')).external_notification_token_set).toBe(true);
    await page.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(page.getByText('Test message sent')).toBeVisible();
    await expect(pill(page)).toHaveText('Connected · @e2e_fake_bot');
    expect(sent.at(-1)).toMatchObject({ token: 'good-token' });
    expect(sent.at(-1)!.body).toContain('42');

    // Clicking the eye after typing shows the value and saves nothing.
    const patches: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('external-notification')) patches.push(r.url()); });
    await tokenField(page).fill('bad');
    await page.getByRole('button', { name: 'Reveal token' }).first().click();
    await expect(tokenField(page)).toHaveAttribute('type', 'text');
    await expect(tokenField(page)).toHaveValue('bad');
    expect(patches).toHaveLength(0);
    await page.getByPlaceholder(/-100/).click(); // blur saves it
    await expect.poll(() => patches.length).toBe(1);
    await expect(pill(page)).toHaveText('Untested');

    // A rejected test says so and flips the pill.
    await page.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(page.getByText('Test failed')).toBeVisible();
    await expect(page.getByText(/Unauthorized/).first()).toBeVisible();
    await expect(pill(page)).toHaveText('Not connected');

    // Fix it, test again.
    await page.reload();
    // Settings must load first: the hydrate effect would wipe a value typed before it.
    await expect(page.getByPlaceholder(/Stored/).first()).toBeVisible();
    await tokenField(page).fill('good-token');
    await tokenField(page).blur();
    await page.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(pill(page)).toHaveText('Connected · @e2e_fake_bot');

    // Reveal shows the stored token read-only.
    await page.reload();
    await page.getByRole('button', { name: 'Reveal token' }).first().click();
    await expect(tokenField(page)).toHaveValue('good-token');
    await tokenField(page).press('End');
    await page.keyboard.type('X');
    await expect(tokenField(page)).toHaveValue('good-token');

    // Editing the chat ID resets the pill until the next test.
    await page.reload();
    await page.getByPlaceholder(/-100/).fill('43');
    await page.getByPlaceholder(/-100/).blur();
    await expect(pill(page)).toHaveText('Untested');
});

test('Teams: a good webhook connects, a failing one says why; Telegram settings survive the switch', async ({ page, request }) => {
    await goto(page, '/settings?tab=notifications', { allow: [/400 \(Bad Request\)/] });
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Teams/ }).click();
    await expect(page.getByRole('button', { name: 'Send Test Message' })).toBeDisabled();

    const webhook = page.getByPlaceholder(/https:\/\/|webhook/i).first();
    await webhook.fill(`http://127.0.0.1:${FAKE_TELEGRAM_PORT}/teams-ok`);
    await webhook.blur();
    await page.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(page.getByText('Test message sent')).toBeVisible();
    await expect(pill(page)).toContainText('Connected');

    await page.reload();
    // Settings must load first: the hydrate effect would wipe a value typed before it.
    await expect(page.getByPlaceholder(/Stored/).first()).toBeVisible();
    await page.getByPlaceholder(/https:\/\/|webhook|Stored/i).first().fill(`http://127.0.0.1:${FAKE_TELEGRAM_PORT}/teams-fail`);
    await page.getByPlaceholder(/https:\/\/|webhook|Stored/i).first().blur();
    await page.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(page.getByText('Test failed')).toBeVisible();
    await expect(pill(page)).toHaveText('Not connected');

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Telegram/ }).click();
    await expect.poll(async () => (await apiGet<{ external_notification_provider: string; external_notification_token_set: boolean }>(request, '/api/settings'))).toMatchObject({
        external_notification_provider: 'telegram',
        external_notification_token_set: true,
    });
});


test('every event toggle persists both ways; quiet hours To, the same-time copy and the time zone persist', async ({ page, request }) => {
    await request.patch(`${API}/api/settings/notifications`, { data: { external_notification_event_toggles: {}, quiet_hours_enabled: 1, quiet_hours_from: '22:00', quiet_hours_to: '08:00', quiet_hours_timezone: 'Pacific/Chatham' } });
    await goto(page, '/settings?tab=notifications');
    const toggles = async () => JSON.parse((await settings(request)).external_notification_event_toggles || '{}') as Record<string, boolean>;
    for (const key of EXTERNAL_NOTIFICATION_EVENT_KEYS) {
        const sw = page.getByRole('switch', { name: EXTERNAL_NOTIFICATION_EVENT_LABELS[key].title, exact: true });
        const was = await sw.isChecked();
        await sw.click();
        await expect.poll(async () => (await toggles())[key]).toBe(!was);
        await page.reload();
        await expect(page.getByRole('switch', { name: EXTERNAL_NOTIFICATION_EVENT_LABELS[key].title, exact: true })).toBeChecked({ checked: !was });
        await page.getByRole('switch', { name: EXTERNAL_NOTIFICATION_EVENT_LABELS[key].title, exact: true }).click();
        await expect.poll(async () => (await toggles())[key]).toBe(was);
    }

    const to = page.getByLabel('Quiet hours to');
    await to.fill('06:45');
    await to.blur();
    await expect(page.getByText('Quiet hours saved')).toBeVisible();
    await expect.poll(async () => (await apiGet<{ quiet_hours_to: string }>(request, '/api/settings')).quiet_hours_to).toBe('06:45');
    await page.reload();
    await expect(page.getByLabel('Quiet hours to')).toHaveValue('06:45');

    await page.getByLabel('Quiet hours from').fill('06:45');
    await expect(page.getByText('From and To are the same, so there is no quiet window.')).toBeVisible();
    await page.getByLabel('Quiet hours from').blur();
    await expect.poll(async () => (await apiGet<{ quiet_hours_from: string }>(request, '/api/settings')).quiet_hours_from).toBe('06:45');

    // The saved zone is not this browser's: say so, and offer to switch.
    const device = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect(page.getByTestId('owner-timezone')).toHaveText('Pacific/Chatham');
    await expect(page.getByText(`(this device is in ${device})`)).toBeVisible();
    await page.getByRole('button', { name: `Use ${device}` }).click();
    await expect(page.getByText(`Time zone set to ${device}`)).toBeVisible();
    await expect.poll(async () => (await apiGet<{ quiet_hours_timezone: string }>(request, '/api/settings')).quiet_hours_timezone).toBe(device);
    await page.reload();
    await expect(page.getByText("(this device's zone)")).toBeVisible();

    // Turning quiet hours off says so and disables the times.
    await page.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(page.getByText('Off — external notifications deliver at any hour.')).toBeVisible();
    await expect(page.getByLabel('Quiet hours from')).toBeDisabled();
    await expect.poll(async () => (await apiGet<{ quiet_hours_enabled: number }>(request, '/api/settings')).quiet_hours_enabled).toBe(0);
});
