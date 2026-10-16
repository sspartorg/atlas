import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { insertNotifications, sql } from '../helpers/db.js';
import { REMINDER_TOOLS } from '../../packages/mcp/src/tools/reminders.js';
import { createApiClient } from '../../packages/mcp/src/api-client.js';

// /reminders on desktop against the REAL API: create every schedule kind ×
// channel through the modal (and every validation error), edit, the menu each
// status offers, each snooze choice, cancel / delete with their confirms, the
// history toggle and paging, the fire log, Refresh, a reminder Claude made
// through the MCP tool, times in the Owner zone, and a real fire landing in
// Notifications. The phone card and axe live in reminders-mobile.spec.ts.

interface Reminder {
    id: number;
    label: string;
    status: string;
    schedule_kind: string;
    schedule_value: string;
    channel: string;
    next_fire_at: string;
    fire_count: number;
}

async function resetReminders(request: APIRequestContext): Promise<void> {
    const all = await apiGet<Reminder[]>(request, '/api/reminders?limit=500');
    for (const r of all) {
        if (r.status === 'active' || r.status === 'paused') await request.delete(`${API}/api/reminders/${r.id}`);
        await request.delete(`${API}/api/reminders/${r.id}?hard=1`);
    }
}

const mk = (request: APIRequestContext, label: string, schedule: unknown, channel = 'notification') =>
    apiPost<Reminder>(request, '/api/reminders', { label, body: '', schedule, channel });

const row = (page: Page, label: string) => page.getByTestId('reminder-row').filter({ hasText: label });

async function openMenu(page: Page, label: string) {
    await page.getByRole('button', { name: `Actions for ${label}` }).click();
    return page.getByRole('menu');
}

async function settings(request: APIRequestContext, patch: Record<string, unknown>) {
    const res = await request.patch(`${API}/api/settings/notifications`, { data: patch });
    expect(res.status(), await res.text()).toBeLessThan(300);
}

test.beforeEach(async ({ request }) => {
    await resetReminders(request);
    await settings(request, { quiet_hours_timezone: 'UTC' });
});
test.afterAll(async ({ request }) => {
    await resetReminders(request);
    sql(`DELETE FROM notifications WHERE event_type = 'reminder'`);
});

const KINDS = [
    { kind: 'Once', fill: async (d: ReturnType<Page['getByRole']>) => d.locator('input[type="datetime-local"]').fill('2099-03-04T05:06'), shows: /^Once on Mar 4, 2099/ },
    { kind: 'Daily', fill: async (d: ReturnType<Page['getByRole']>) => d.getByLabel('Time').fill('07:45'), shows: /^Daily at 07:45$/ },
    {
        kind: 'Weekly',
        fill: async (d: ReturnType<Page['getByRole']>) => {
            await d.getByLabel('Time').fill('18:30');
            for (const day of ['Tue', 'Wed', 'Thu']) await d.getByRole('checkbox', { name: day }).uncheck();
            await d.getByRole('checkbox', { name: 'Sat' }).check();
        },
        shows: /^Weekly Mon, Fri, Sat at 18:30$/,
    },
    { kind: 'Cron', fill: async (d: ReturnType<Page['getByRole']>) => d.getByLabel('Cron expression').fill('*/15 9-17 * * 1-5'), shows: /^cron: \*\/15 9-17 \* \* 1-5$/ },
] as const;
const CHANNELS = [
    { radio: 'In-app', value: 'notification', icon: 'In-app' },
    { radio: 'External Notification', value: 'external', icon: 'External Notification' },
    { radio: 'Both', value: 'both', icon: 'In-app + External Notification' },
] as const;

test.describe('/reminders — create', () => {
    test('every schedule kind × channel through the modal', async ({ page, request }) => {
        test.slow();
        await goto(page, '/reminders');
        await expect(page.getByText('No active reminders')).toBeVisible();
        for (const k of KINDS) {
            for (const c of CHANNELS) {
                const label = `${k.kind} via ${c.value}`;
                await page.getByRole('button', { name: 'New reminder' }).click();
                const d = page.getByRole('dialog', { name: 'New reminder' });
                await d.getByLabel('Label').fill(label);
                await d.getByLabel('Body (optional)').fill(`Body of ${label}`);
                await d.getByRole('radio', { name: k.kind }).check();
                await k.fill(d);
                await d.getByRole('radio', { name: c.radio, exact: true }).check();
                await d.getByRole('button', { name: 'Create reminder' }).click();
                await expect(page.getByText(`Reminder "${label}" created`)).toBeVisible();
                await expect(d).toHaveCount(0);
                const r = row(page, label);
                await expect(r.getByText(k.kind.toLowerCase(), { exact: true })).toBeVisible();
                await expect(r.getByText(k.shows)).toBeVisible();
                await expect(r.getByRole('img', { name: c.icon, exact: true })).toBeVisible();
                await expect(r.getByText(`Body of ${label}`)).toBeVisible();
                await expect(r.getByText('active', { exact: true })).toBeVisible();
                await expect(r.getByText(/^Next (in|on) /)).toBeVisible();
            }
        }
        const all = await apiGet<Reminder[]>(request, '/api/reminders?status=active');
        expect(all).toHaveLength(12);
        const weekly = all.find((r) => r.label === 'Weekly via both');
        expect(weekly).toMatchObject({ schedule_kind: 'weekly', schedule_value: '18:30|1,5,6', channel: 'both' });
        expect(all.find((r) => r.label === 'Once via external')).toMatchObject({ schedule_value: '2099-03-04T05:06:00.000Z', channel: 'external' });
    });

    test('every validation error is shown, and nothing is created', async ({ page, request }) => {
        await goto(page, '/reminders', { allow: [/400 \(Bad Request\)/] });
        await page.getByRole('button', { name: 'New reminder' }).click();
        const d = page.getByRole('dialog', { name: 'New reminder' });
        const create = d.getByRole('button', { name: 'Create reminder' });
        const alert = d.getByRole('alert');

        // Empty / blank label: Create stays disabled.
        await expect(create).toBeDisabled();
        await d.getByLabel('Label').fill('   ');
        await expect(create).toBeDisabled();
        // Over 200 characters cannot be typed; the counter says where you are.
        await d.getByLabel('Label').fill('x'.repeat(250));
        await expect(d.getByLabel('Label')).toHaveValue('x'.repeat(200));
        await expect(d.getByText('200/200')).toBeVisible();
        await d.getByLabel('Label').fill('Validation');

        await d.locator('input[type="datetime-local"]').fill('2001-01-01T09:00');
        await create.click();
        await expect(alert).toHaveText('Pick a time in the future.');

        await d.getByRole('radio', { name: 'Weekly' }).check();
        for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await d.getByRole('checkbox', { name: day }).uncheck();
        await create.click();
        await expect(alert).toHaveText('Pick at least one weekday.');

        await d.getByRole('radio', { name: 'Cron' }).check();
        await d.getByLabel('Cron expression').fill('   ');
        await create.click();
        await expect(alert).toHaveText('Enter a cron expression.');
        await d.getByLabel('Cron expression').fill('every tuesday');
        await create.click();
        await expect(alert).toContainText('Invalid cron expression "every tuesday"');
        await d.getByLabel('Cron expression').fill('0 0 30 2 *');
        await create.click();
        await expect(alert).toContainText('has no future fire');

        // Cancel and Escape both close without creating.
        await d.getByRole('button', { name: 'Cancel' }).click();
        await expect(d).toHaveCount(0);
        await page.getByRole('button', { name: 'New reminder' }).click();
        await page.keyboard.press('Escape');
        await expect(d).toHaveCount(0);
        expect(await apiGet<Reminder[]>(request, '/api/reminders')).toHaveLength(0);
    });
});

test.describe('/reminders — row actions', () => {
    test('Edit opens prefilled and saves every field', async ({ page, request }) => {
        const r = await mk(request, 'Edit me', { kind: 'weekly', weekdays: [2, 4], time_of_day: '10:15' }, 'both');
        await goto(page, '/reminders');
        (await openMenu(page, 'Edit me')).getByRole('menuitem', { name: 'Edit' }).click();
        const d = page.getByRole('dialog', { name: 'Edit reminder' });
        await expect(d.getByLabel('Label')).toHaveValue('Edit me');
        await expect(d.getByRole('radio', { name: 'Weekly' })).toBeChecked();
        await expect(d.getByLabel('Time')).toHaveValue('10:15');
        await expect(d.getByRole('checkbox', { name: 'Tue' })).toBeChecked();
        await expect(d.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
        await expect(d.getByRole('radio', { name: 'Both' })).toBeChecked();
        await d.getByLabel('Label').fill('Edited');
        await d.getByRole('radio', { name: 'Daily' }).check();
        await d.getByLabel('Time').fill('06:05');
        await d.getByRole('radio', { name: 'In-app' }).check();
        await d.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText('Reminder "Edited" updated')).toBeVisible();
        await expect(row(page, 'Edited').getByText('Daily at 06:05')).toBeVisible();
        expect(await apiGet<Reminder>(request, `/api/reminders/${r.id}`)).toMatchObject({ schedule_kind: 'daily', schedule_value: '06:05', channel: 'notification' });
    });

    test('each status offers exactly its actions', async ({ page, request }) => {
        const a = await mk(request, 'Is active', { kind: 'daily', time_of_day: '09:00' });
        const p = await mk(request, 'Is paused', { kind: 'daily', time_of_day: '09:00' });
        await request.patch(`${API}/api/reminders/${p.id}`, { data: { status: 'paused' } });
        const c = await mk(request, 'Is cancelled', { kind: 'daily', time_of_day: '09:00' });
        await request.delete(`${API}/api/reminders/${c.id}`);
        const done = await mk(request, 'Is completed', { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() });
        sql(`UPDATE reminders SET status = 'completed' WHERE id = ${done.id}`);
        void a;
        await goto(page, '/reminders');
        await page.getByRole('switch', { name: 'Show history' }).check();
        const snoozes = ['Snooze 10 minutes', 'Snooze 1 hour', 'Snooze until tomorrow 9:00'];
        for (const [label, items] of [
            ['Is active', ['Edit', 'Pause', ...snoozes, 'Cancel reminder']],
            ['Is paused', ['Edit', 'Resume', ...snoozes, 'Cancel reminder']],
            ['Is completed', [...snoozes, 'Delete']],
            ['Is cancelled', ['Delete']],
        ] as const) {
            const m = await openMenu(page, label);
            await expect(m.getByRole('menuitem')).toHaveText([...items]);
            await page.keyboard.press('Escape');
            await expect(m).toHaveCount(0);
        }
        await expect(row(page, 'Is paused').getByText('Paused · never fired')).toBeVisible();
        await expect(row(page, 'Is completed').getByText(/^Completed (just now|\dm ago)$/)).toBeVisible();
    });

    test('pause, resume and each snooze choice move the reminder as named', async ({ page, request }) => {
        const r = await mk(request, 'Snoozy', { kind: 'daily', time_of_day: '09:00' });
        await goto(page, '/reminders');
        (await openMenu(page, 'Snoozy')).getByRole('menuitem', { name: 'Pause' }).click();
        await expect(page.getByText('Reminder "Snoozy" paused')).toBeVisible();
        await expect(row(page, 'Snoozy').getByText('paused', { exact: true })).toBeVisible();
        (await openMenu(page, 'Snoozy')).getByRole('menuitem', { name: 'Resume' }).click();
        await expect(page.getByText('Reminder "Snoozy" resumed')).toBeVisible();
        await expect(row(page, 'Snoozy').getByText('active', { exact: true })).toBeVisible();

        const minutesOut = async () => (new Date((await apiGet<Reminder>(request, `/api/reminders/${r.id}`)).next_fire_at).getTime() - Date.now()) / 60_000;
        (await openMenu(page, 'Snoozy')).getByRole('menuitem', { name: 'Snooze 10 minutes' }).click();
        await expect(page.getByText(/^Snoozed until /)).toBeVisible();
        await expect(row(page, 'Snoozy').getByText(/^Next in (9|10)m$/)).toBeVisible();
        expect(await minutesOut()).toBeGreaterThan(8);
        expect(await minutesOut()).toBeLessThan(11);

        (await openMenu(page, 'Snoozy')).getByRole('menuitem', { name: 'Snooze 1 hour' }).click();
        await expect(row(page, 'Snoozy').getByText(/^Next in (59m|1h)$/)).toBeVisible();

        (await openMenu(page, 'Snoozy')).getByRole('menuitem', { name: 'Snooze until tomorrow 9:00' }).click();
        await expect.poll(async () => new Date((await apiGet<Reminder>(request, `/api/reminders/${r.id}`)).next_fire_at).toISOString()).toMatch(/T09:00:/);
        const next = new Date((await apiGet<Reminder>(request, `/api/reminders/${r.id}`)).next_fire_at);
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        expect(next.toISOString().slice(0, 10)).toBe(tomorrow.toISOString().slice(0, 10));
    });

    test('Cancel asks first (Keep keeps it); Delete asks first and removes it for good', async ({ page, request }) => {
        const r = await mk(request, 'Cancel me', { kind: 'daily', time_of_day: '09:00' });
        await goto(page, '/reminders');
        (await openMenu(page, 'Cancel me')).getByRole('menuitem', { name: 'Cancel reminder' }).click();
        const dlg = page.getByRole('dialog', { name: 'Cancel reminder?' });
        await expect(dlg).toContainText('Cancel me — It will stop firing and move to history.');
        await dlg.getByRole('button', { name: 'Keep' }).click();
        await expect(dlg).toHaveCount(0);
        await expect(row(page, 'Cancel me').getByText('active', { exact: true })).toBeVisible();

        (await openMenu(page, 'Cancel me')).getByRole('menuitem', { name: 'Cancel reminder' }).click();
        await expect(dlg).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dlg).toHaveCount(0);
        (await openMenu(page, 'Cancel me')).getByRole('menuitem', { name: 'Cancel reminder' }).click();
        await dlg.getByRole('button', { name: 'Cancel reminder' }).click();
        await expect(page.getByText('Reminder "Cancel me" cancelled')).toBeVisible();
        await expect(page.getByText('No active reminders')).toBeVisible();

        await page.getByRole('switch', { name: 'Show history' }).check();
        await expect(row(page, 'Cancel me').getByText('cancelled', { exact: true })).toBeVisible();
        (await openMenu(page, 'Cancel me')).getByRole('menuitem', { name: 'Delete' }).click();
        const del = page.getByRole('dialog', { name: 'Delete reminder?' });
        await expect(del).toContainText('removed from history for good');
        await del.getByRole('button', { name: 'Keep' }).click();
        await expect(row(page, 'Cancel me')).toBeVisible();
        (await openMenu(page, 'Cancel me')).getByRole('menuitem', { name: 'Delete' }).click();
        await del.getByRole('button', { name: 'Delete reminder' }).click();
        await expect(page.getByText('Reminder "Cancel me" deleted')).toBeVisible();
        await expect(page.getByText('No finished reminders yet.', { exact: false })).toBeVisible();
        expect((await request.get(`${API}/api/reminders/${r.id}`)).status()).toBe(404);
    });

    test('an action the server refuses says why', async ({ page, request }) => {
        const r = await mk(request, 'Gone underneath', { kind: 'daily', time_of_day: '09:00' });
        await goto(page, '/reminders', { allow: [/409|Conflict/] });
        await expect(row(page, 'Gone underneath')).toBeVisible();
        await request.delete(`${API}/api/reminders/${r.id}`);
        (await openMenu(page, 'Gone underneath')).getByRole('menuitem', { name: 'Snooze 1 hour' }).click();
        await expect(page.getByText('Could not snooze reminder')).toBeVisible();
        await expect(page.getByText('A cancelled reminder cannot be snoozed')).toBeVisible();
    });
});

test.describe('/reminders — history, fire log, refresh', () => {
    test('history pages 50 at a time with Show more history', async ({ page }) => {
        sql(`INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status, updated_at)
             SELECT 'Old ' || lpad(g::text, 2, '0'), '', 'daily', '08:00', 'notification', now(), 'completed', now() - (g || ' minutes')::interval
               FROM generate_series(1, 55) g`);
        await goto(page, '/reminders');
        await expect(page.getByRole('region', { name: 'History' })).toHaveCount(0);
        await page.getByRole('switch', { name: 'Show history' }).check();
        const hist = page.getByRole('region', { name: 'History' });
        await expect(hist.getByTestId('reminder-row')).toHaveCount(50);
        await expect(hist.getByTestId('reminder-row').first()).toContainText('Old 01');
        await hist.getByRole('button', { name: 'Show more history' }).click();
        await expect(hist.getByTestId('reminder-row')).toHaveCount(55);
        await expect(hist.getByRole('button', { name: 'Show more history' })).toHaveCount(0);
        await page.getByRole('switch', { name: 'Show history' }).uncheck();
        await expect(hist).toHaveCount(0);
    });

    test('the fire log lists each fire with its push and external outcome', async ({ page, request }) => {
        const r = await mk(request, 'Fired thrice', { kind: 'daily', time_of_day: '08:00' }, 'both');
        insertNotifications([
            { event_type: 'reminder', message: 'Fired thrice', kind: 'system', reminder_id: r.id, push_status: 'sent', external_status: 'sent', ago: 3000 },
            { event_type: 'reminder', message: 'Fired thrice', kind: 'system', reminder_id: r.id, push_status: 'failed', external_status: 'failed', failure_reason: 'Forbidden: bot was blocked', ago: 1500 },
            { event_type: 'reminder', message: 'Fired thrice', kind: 'system', reminder_id: r.id, push_status: 'none', external_status: 'pending', deferred: true, ago: 10 },
        ]);
        await request.delete(`${API}/api/reminders/${r.id}`);
        await goto(page, '/reminders');
        await page.getByRole('switch', { name: 'Show history' }).check();
        const hist = row(page, 'Fired thrice');
        await expect(hist.getByText(/^Cancelled (just now|\dm ago) · fired 3×$/)).toBeVisible();
        const toggle = hist.getByRole('button', { name: /show fire log/ });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        const log = hist.getByRole('list', { name: 'Fire log' });
        await expect(log.getByRole('listitem')).toHaveCount(3);
        await expect(log.getByRole('listitem').nth(0)).toContainText('push offexternal held / sending');
        await expect(log.getByRole('listitem').nth(1)).toContainText('push failedexternal failed · Forbidden: bot was blocked');
        await expect(log.getByRole('listitem').nth(2)).toContainText('push sentexternal sent');
        await hist.getByRole('button', { name: /hide fire log/ }).click();
        await expect(log).toHaveCount(0);
    });

    test('Refresh picks up a reminder made elsewhere (Claude, through the MCP tool)', async ({ page, request }) => {
        await goto(page, '/reminders');
        await expect(page.getByText('No active reminders')).toBeVisible();
        const crud = REMINDER_TOOLS.find((t) => t.name === 'crud_reminder');
        const client = createApiClient({ apiBase: API, requestTimeoutMs: 10_000, mcpToken: '', boundAgentId: '' });
        const res = await crud!.handler(
            { op: 'create', label: 'Set by Claude', body: 'from crud_reminder', schedule: { kind: 'cron', expr: '0 8 * * 1' }, channel: 'external' },
            { client },
        );
        expect(res.isError ?? false).toBe(false);
        await page.getByRole('button', { name: 'Refresh reminders' }).click();
        const r = row(page, 'Set by Claude');
        await expect(r.getByText('cron: 0 8 * * 1')).toBeVisible();
        await expect(r.getByRole('img', { name: 'External Notification', exact: true })).toBeVisible();
        // A pause through the tool shows on the next refresh too.
        const [made] = await apiGet<Reminder[]>(request, '/api/reminders?status=active');
        await crud!.handler({ op: 'pause', id: made!.id }, { client });
        await page.getByRole('button', { name: 'Refresh reminders' }).click();
        await expect(r.getByText('paused', { exact: true })).toBeVisible();
    });

    test('a failed load is an error, not "No active reminders"', async ({ page }) => {
        await page.route(/\/api\/reminders\?status=active%2Cpaused|\/api\/reminders\?status=active,paused/, (r) =>
            r.fulfill({ status: 500, json: { error: 'database is down', kind: 'internal_error' } }),
        );
        await goto(page, '/reminders', { allow: [/500|Internal Server Error/] });
        await expect(page.getByRole('alert')).toContainText('Could not load reminders: database is down');
        await expect(page.getByText('No active reminders')).toHaveCount(0);
    });
});

test.describe('/reminders — the Owner zone, not the browser zone', () => {
    // The browser is in New York; the Owner zone is Tokyo (UTC+9, no DST).
    test.use({ timezoneId: 'America/New_York' });

    test('the subtitle, a Once time typed in the modal, the row and its tooltip are all Tokyo time', async ({ page, request }) => {
        await settings(request, { quiet_hours_timezone: 'Asia/Tokyo' });
        await goto(page, '/reminders');
        await expect(page.getByText('Asia/Tokyo')).toBeVisible();
        await page.getByRole('button', { name: 'New reminder' }).click();
        const d = page.getByRole('dialog', { name: 'New reminder' });
        await expect(d.getByText('In Asia/Tokyo')).toBeVisible();
        await d.getByLabel('Label').fill('Tokyo morning');
        await d.locator('input[type="datetime-local"]').fill('2099-07-01T09:30');
        await d.getByRole('button', { name: 'Create reminder' }).click();
        await expect(page.getByText('Reminder "Tokyo morning" created')).toBeVisible();
        const [r] = await apiGet<Reminder[]>(request, '/api/reminders?status=active');
        // 09:30 in Tokyo is 00:30 UTC.
        expect(r!.next_fire_at).toBe('2099-07-01T00:30:00.000Z');
        await expect(row(page, 'Tokyo morning').getByText('Once on Jul 1, 2099, 9:30 AM')).toBeVisible();
        await row(page, 'Tokyo morning').getByText(/^Next on /).hover();
        await expect(page.getByRole('tooltip')).toHaveText('Jul 1, 2099, 9:30 AM');
        // Editing shows the same wall time back.
        (await openMenu(page, 'Tokyo morning')).getByRole('menuitem', { name: 'Edit' }).click();
        await expect(page.getByRole('dialog', { name: 'Edit reminder' }).locator('input[type="datetime-local"]')).toHaveValue('2099-07-01T09:30');
    });
});

test.describe('/reminders — a real fire', () => {
    test.describe.configure({ timeout: 150_000 });

    test('a due reminder fires on the minute tick: it lands in Notifications live and the row completes', async ({ page, request }) => {
        sql(`DELETE FROM notifications WHERE event_type = 'reminder'`);
        await goto(page, '/notifications?tab=in-app');
        const r = await mk(request, 'Real fire', { kind: 'once', at: new Date(Date.now() + 2_000).toISOString() });
        const card = page.getByTestId('notification-card').filter({ hasText: 'Real fire' });
        await expect(card).toBeVisible({ timeout: 90_000 });
        await expect(card.getByRole('button', { name: 'Snooze reminder' })).toBeVisible();
        await expect(page.getByTestId('nav-item-notifications')).toContainText('1');
        expect(await apiGet<Reminder>(request, `/api/reminders/${r.id}`)).toMatchObject({ status: 'completed', fire_count: 1 });
        await goto(page, '/reminders');
        await expect(page.getByText('No active reminders')).toBeVisible();
        await page.getByRole('switch', { name: 'Show history' }).check();
        await expect(row(page, 'Real fire').getByText(/^Completed (just now|\dm ago) · fired 1×$/)).toBeVisible();
    });

    test('an open Reminders page follows a fire without a refresh', async ({ page, request }) => {
        await goto(page, '/reminders');
        await mk(request, 'Fires while open', { kind: 'once', at: new Date(Date.now() + 2_000).toISOString() });
        await page.getByRole('button', { name: 'Refresh reminders' }).click();
        await expect(row(page, 'Fires while open')).toBeVisible();
        await expect(page.getByText('No active reminders')).toBeVisible({ timeout: 90_000 });
    });
});
