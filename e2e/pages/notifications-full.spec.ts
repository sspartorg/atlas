import { createServer, type Server } from 'node:http';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, FAKE_TELEGRAM_PORT, apiGet, apiPost, chainGraph, createTask, createWorkflow } from '../helpers/api.js';
import { insertNotifications, sql, type NotificationRow } from '../helpers/db.js';

// /notifications against the REAL API: every event type's icon, label and click
// target; every delivery chip and its action (Resend, Retry, Cancel, Send now)
// through a fake Telegram Bot API; filter pills and counts; Load more; Mark All
// Read with the sidenav badge and the topbar popover; a live arrival over SSE;
// and the needs_you rule (the row drops once its item moves on).
// Rows are inserted straight into atlas_e2e (helpers/db.ts) except where the
// point is a real producer.

let fake: Server;
let sent: string[] = [];
test.beforeAll(async () => {
    fake = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            const m = /^\/bot([^/]+)\/(sendMessage|getMe)/.exec(req.url ?? '');
            // Like the real Bot API: with a parse_mode, an unbalanced entity is
            // a 400 — the bug that kept every workflow park off Telegram.
            if (m?.[2] === 'sendMessage' && unparseable(body)) {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }));
                return;
            }
            res.writeHead(m && m[1] !== 'bad' ? 200 : 401, { 'content-type': 'application/json' });
            if (m?.[2] === 'sendMessage' && m[1] !== 'bad') sent.push(body);
            res.end(JSON.stringify(m && m[1] !== 'bad' ? { ok: true, result: { username: 'e2e_fake_bot' } } : { ok: false, description: 'Unauthorized' }));
        });
    });
    await new Promise<void>((r) => fake.listen(FAKE_TELEGRAM_PORT, '127.0.0.1', () => r()));
});

function unparseable(body: string): boolean {
    const { text, parse_mode } = JSON.parse(body || '{}') as { text?: string; parse_mode?: string };
    if (!parse_mode || !text) return false;
    const odd = (ch: string) => text.split(ch).length % 2 === 0;
    return odd('_') || odd('*') || odd('`') || text.split('[').length !== text.split(']').length;
}

async function telegram(request: APIRequestContext, token: string | null): Promise<void> {
    const res = await request.patch(`${API}/api/settings/external-notification`, {
        data: { external_notification_provider: 'telegram', external_notification_token: token, external_notification_chat_id: token ? '42' : null },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
}

/** Quiet hours around now (UTC), so the minute tick never sends a held row mid-test. */
async function quietNow(request: APIRequestContext, on: boolean): Promise<void> {
    const h = new Date().getUTCHours();
    const hh = (n: number) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
    await request.patch(`${API}/api/settings/notifications`, {
        data: on
            ? { quiet_hours_enabled: 1, quiet_hours_from: hh(h - 1), quiet_hours_to: hh(h + 2), quiet_hours_timezone: 'UTC' }
            : { quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00' },
    });
}

test.beforeEach(() => {
    sql('DELETE FROM notifications');
    sent = [];
});

test.afterAll(async ({ request }) => {
    fake.close();
    sql('DELETE FROM notifications');
    await telegram(request, null);
    await quietNow(request, false);
});

const feedCard = (page: Page, message: string) => page.getByTestId('notification-card').filter({ hasText: message });
const logRow = (page: Page, message: string) => page.getByTestId('notification-log-row').filter({ hasText: message });
const badge = (page: Page) => page.getByTestId('nav-item-notifications');

// Every event_type a producer writes (grep `notificationsService.create` in
// packages/api/src/services) + an unknown one, with the link it carries or
// the fallback `notificationLinkUrl` derives, and the icon EventTypeIcon draws.
const EVENTS: Array<{ row: NotificationRow; label: string; icon: string; url: RegExp }> = [
    { row: { event_type: 'workflow_run', message: 'Delivery finished ETM-1', item_id: 'ETM-1', link_url: '/workflows/wf-x/runs/run-x' }, label: 'Workflow', icon: 'workflow', url: /\/workflows\/wf-x\/runs\/run-x$/ },
    { row: { event_type: 'agent_completed', message: 'Coder finished ETM-1 (legacy row)', item_id: 'ETM-1' }, label: 'Agent Completed', icon: 'task_alt', url: /\/tasks\/ETM-1$/ },
    { row: { event_type: 'agent_completed_no_item', message: 'Freedom run finished', link_url: '/agents/agent-x/runs/run-1' }, label: 'Agent Run Finished', icon: 'task_alt', url: /\/agents\/agent-x\/runs\/run-1$/ },
    { row: { event_type: 'agent_error', message: 'Coder failed on ETM-2', kind: 'needs_you', item_id: 'ETM-2' }, label: 'Agent Failed', icon: 'error', url: /\/sub-tasks\/ETM-2$/ },
    { row: { event_type: 'agent_error_no_item', message: 'Freedom run failed', link_url: '/agents/agent-x/runs/run-2' }, label: 'Agent Run Failed', icon: 'error', url: /\/agents\/agent-x\/runs\/run-2$/ },
    { row: { event_type: 'ci_failed', message: 'CI failed on the ETM-1 PR', kind: 'needs_you', item_id: 'ETM-1' }, label: 'CI Failed', icon: 'bug_report', url: /\/tasks\/ETM-1$/ },
    { row: { event_type: 'reminder', message: 'Water the plants (an older reminder row)', kind: 'system' }, label: 'Reminder', icon: 'alarm', url: /\/reminders$/ },
    { row: { event_type: 'jira_sync', message: 'Jira sync failed: 401', kind: 'needs_you' }, label: 'Jira', icon: 'sync_alt', url: /\/settings\?tab=jira$/ },
    { row: { event_type: 'terminal.waiting_for_input', message: 'Terminal "fix" is idle', kind: 'needs_you', link_url: '/terminal/s-1' }, label: 'Terminal Waiting', icon: 'terminal', url: /\/terminal\/s-1$/ },
    { row: { event_type: 'autofetch_success', message: 'Auto-fetch pulled 3 commits', kind: 'system', project_id: 'e2e-terminal-project' }, label: 'Auto-fetch Success', icon: 'sync', url: /\/projects\/e2e-terminal-project$/ },
    { row: { event_type: 'autofetch_skipped', message: 'Auto-fetch skipped: dirty tree', kind: 'system', project_id: 'e2e-terminal-project' }, label: 'Auto-fetch Skipped', icon: 'sync_disabled', url: /\/projects\/e2e-terminal-project$/ },
    { row: { event_type: 'autofetch_failed', message: 'Auto-fetch failed: remote hung up', kind: 'system', project_id: 'e2e-terminal-project' }, label: 'Auto-fetch Failed', icon: 'cloud_off', url: /\/projects\/e2e-terminal-project$/ },
    { row: { event_type: 'autofetch_conflict', message: 'Auto-fetch hit a conflict', kind: 'system', project_id: 'e2e-terminal-project' }, label: 'Auto-fetch Conflict', icon: 'merge_type', url: /\/projects\/e2e-terminal-project$/ },
    { row: { event_type: 'autofetch_disabled', message: 'Auto-fetch turned off after 3 failures', kind: 'needs_you', project_id: 'e2e-terminal-project' }, label: 'Auto-fetch Disabled', icon: 'block', url: /\/projects\/e2e-terminal-project$/ },
    { row: { event_type: 'some_new_event', message: 'A producer this page does not know yet' }, label: 'Some New Event', icon: 'notifications', url: /\/notifications$/ },
];

test.describe('/notifications — every event type', () => {
    test('each renders its icon and label, and a click marks it read and lands on its page', async ({ page }) => {
        insertNotifications(EVENTS.map((e, i) => ({ ...e.row, ago: i + 1 })));
        await goto(page, '/notifications?tab=in-app');
        for (const e of EVENTS) {
            const card = feedCard(page, e.row.message);
            await expect(card).toHaveAttribute('aria-label', `Unread: ${e.label}: ${e.row.message}`);
            await expect(card.locator('.material-symbols-rounded').first()).toHaveText(e.icon);
        }
        for (const e of EVENTS) {
            await feedCard(page, e.row.message).click();
            await expect(page).toHaveURL(e.url);
            await goto(page, '/notifications?tab=in-app', { allow: [/404|Not Found|Failed to load/] });
            await expect(feedCard(page, e.row.message)).toHaveAttribute('aria-label', `${e.label}: ${e.row.message}`);
        }
        // The keyboard opens a card too.
        sql('UPDATE notifications SET read_at = NULL');
        await goto(page, '/notifications?tab=in-app');
        await feedCard(page, 'Jira sync failed: 401').focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/settings\?tab=jira$/);
        await page.goBack();
        await feedCard(page, 'Water the plants').focus();
        await page.keyboard.press(' ');
        await expect(page).toHaveURL(/\/reminders$/);
    });

    test('a log-only row (MCP send, external-only reminder) is on the log, not the feed', async ({ page }) => {
        insertNotifications([
            { event_type: 'mcp_external', message: 'Daily AI digest', kind: 'system', external_status: 'sent', in_app: false, link_url: '/notifications?tab=external' },
            { event_type: 'reminder', message: 'External-only reminder fire', kind: 'system', external_status: 'failed', failure_reason: 'Forbidden: bot was blocked', in_app: false },
        ]);
        await goto(page, '/notifications');
        await expect(logRow(page, 'Daily AI digest')).toContainText('Sent by Claude');
        await expect(logRow(page, 'Daily AI digest').locator('.material-symbols-rounded').first()).toHaveText('send');
        await expect(logRow(page, 'External-only reminder fire')).toContainText('⚠ Forbidden: bot was blocked');
        await page.getByRole('tab', { name: 'In-App Feed' }).click();
        await expect(page).toHaveURL(/tab=in-app/);
        await expect(page.getByText('Nothing here yet.')).toBeVisible();
        await expect(badge(page)).not.toContainText(/\d/);
    });
});

test.describe('/notifications — Notification Log: chips, pills, actions', () => {
    test.beforeEach(async ({ request }) => {
        await telegram(request, 'good-token');
        await quietNow(request, true);
    });

    function seedLog(): Record<string, number> {
        const [sentId, failed, held, flight, skipped, none] = insertNotifications([
            { event_type: 'workflow_run', message: 'Row sent', item_id: 'ETM-1', external_status: 'sent', ago: 1 },
            { event_type: 'agent_error', message: 'Row failed', item_id: 'ETM-2', external_status: 'failed', failure_reason: 'Telegram: 429 Too Many Requests', ago: 2 },
            { event_type: 'reminder', message: 'Row held', kind: 'system', external_status: 'pending', deferred: true, ago: 3 },
            { event_type: 'ci_failed', message: 'Row in flight', item_id: 'ETM-1', external_status: 'pending', ago: 4 },
            { event_type: 'mcp_external', message: 'Row skipped', kind: 'system', failure_reason: 'Skipped: event turned off while held', in_app: false, ago: 5 },
            { event_type: 'jira_sync', message: 'Row with no send', ago: 6 },
        ]);
        return { sentId: sentId!, failed: failed!, held: held!, flight: flight!, skipped: skipped!, none: none! };
    }

    test('every delivery state has its chip, and the pills count and filter them', async ({ page }) => {
        seedLog();
        await goto(page, '/notifications');
        await expect(logRow(page, 'Row sent')).toContainText('Sent');
        await expect(logRow(page, 'Row sent')).toContainText('ETM-1');
        await expect(logRow(page, 'Row failed')).toContainText('Failed');
        await expect(logRow(page, 'Row failed')).toContainText('⚠ Telegram: 429 Too Many Requests');
        const h = new Date().getUTCHours();
        await expect(logRow(page, 'Row held')).toContainText('Held · quiet hours');
        await expect(logRow(page, 'Row held')).toContainText(`sends ${String((h + 2) % 24).padStart(2, '0')}:00`);
        await expect(logRow(page, 'Row in flight')).toContainText('Pending');
        await expect(logRow(page, 'Row skipped')).toContainText('Skipped');
        await expect(logRow(page, 'Row skipped')).toContainText('Skipped: event turned off while held');
        await expect(logRow(page, 'Row with no send')).toHaveCount(0);

        const pills = page.getByRole('group', { name: 'Filter deliveries' });
        const expectCounts: Array<[string, number, string[]]> = [
            ['Sent', 1, ['Row sent']],
            ['Failed', 1, ['Row failed']],
            ['Pending', 2, ['Row held', 'Row in flight']],
            ['Skipped', 1, ['Row skipped']],
            ['All', 5, ['Row sent', 'Row failed', 'Row held', 'Row in flight', 'Row skipped']],
        ];
        for (const [name, n, rows] of expectCounts) {
            const pill = pills.getByRole('button', { name: new RegExp(`^${name}`) });
            await expect(pill).toContainText(String(n));
            await pill.click();
            await expect(page.getByTestId('notification-log-row')).toHaveCount(rows.length);
            for (const r of rows) await expect(logRow(page, r)).toBeVisible();
        }
        // A filter with nothing in it says so.
        sql(`UPDATE notifications SET external_status = 'sent' WHERE external_status = 'failed'`);
        await page.getByRole('button', { name: 'Refresh notifications' }).click();
        await pills.getByRole('button', { name: /^Failed/ }).click();
        await expect(page.getByText('No deliveries match this filter.')).toBeVisible();
    });

    test('Resend, Retry, Cancel and Send now each work and move the chip', async ({ page }) => {
        seedLog();
        await goto(page, '/notifications');

        await logRow(page, 'Row sent').getByRole('button', { name: 'Resend' }).click();
        await expect(page.getByText('Resent external notification')).toBeVisible();
        await expect.poll(() => sent.some((b) => b.includes('Row sent'))).toBe(true);
        await expect(logRow(page, 'Row sent')).toContainText('Sent');

        await logRow(page, 'Row failed').getByRole('button', { name: 'Retry' }).click();
        await expect(logRow(page, 'Row failed').getByText('Sent', { exact: true })).toBeVisible();
        await expect(logRow(page, 'Row failed')).not.toContainText('429');

        await logRow(page, 'Row held').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByText('Cancelled pending delivery')).toBeVisible();
        await expect(logRow(page, 'Row held').getByText('Cancelled', { exact: true })).toBeVisible();
        await expect(logRow(page, 'Row held')).toContainText('Cancelled by you');
        await expect(logRow(page, 'Row held')).not.toContainText('sends');
        await logRow(page, 'Row held').getByRole('button', { name: 'Send now' }).click();
        await expect(logRow(page, 'Row held').getByText('Sent', { exact: true })).toBeVisible();
        expect(sent.some((b) => b.includes('Row held'))).toBe(true);

        await logRow(page, 'Row in flight').getByRole('button', { name: 'Cancel' }).click();
        await expect(logRow(page, 'Row in flight').getByText('Cancelled', { exact: true })).toBeVisible();

        await logRow(page, 'Row skipped').getByRole('button', { name: 'Send now' }).click();
        await expect(logRow(page, 'Row skipped').getByText('Sent', { exact: true })).toBeVisible();
    });

    test('a transport failure on Retry says why; no channel says so and leaves the row', async ({ page, request }) => {
        seedLog();
        await telegram(request, 'bad');
        await goto(page, '/notifications', { allow: [/502|Bad Gateway/] });
        await logRow(page, 'Row sent').getByRole('button', { name: 'Resend' }).click();
        await expect(page.getByText('Resend failed')).toBeVisible();
        await expect(logRow(page, 'Row sent').getByText('Failed', { exact: true })).toBeVisible();
        await expect(logRow(page, 'Row sent')).toContainText('Unauthorized');

        await telegram(request, null);
        await page.reload();
        await logRow(page, 'Row failed').getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByText('No external channel is connected. Set one up in Settings → Notifications.')).toBeVisible();
        await expect(logRow(page, 'Row failed')).toContainText('429');
    });

    test('a refused cancel says so (someone else already sent it)', async ({ page }) => {
        const { flight } = seedLog();
        await goto(page, '/notifications', { allow: [/409|Conflict/] });
        const cancel = logRow(page, 'Row in flight').getByRole('button', { name: 'Cancel' });
        await expect(cancel).toBeVisible();
        sql(`UPDATE notifications SET external_status = 'sent' WHERE id = ${flight}`);
        await cancel.click();
        await expect(page.getByText('Cancel failed')).toBeVisible();
        await expect(page.getByText('Only pending deliveries can be cancelled')).toBeVisible();
    });
});

test.describe('/notifications — empty, error and the header', () => {
    test('no channel: the empty log, the red subtitle link and a disabled test button', async ({ page, request }) => {
        await telegram(request, null);
        await goto(page, '/notifications');
        await expect(page.getByText('No External Channel Yet')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Send a Test Message' })).toBeDisabled();
        await page.getByRole('link', { name: 'Settings → Notifications' }).click();
        await expect(page).toHaveURL(/\/settings\?tab=notifications$/);
    });

    test('a connected, untested channel: the subtitle says so and Send a Test Message works, then fails honestly', async ({ page, request }) => {
        await telegram(request, 'good-token');
        await goto(page, '/notifications');
        await expect(page.getByText('Telegram set up, not tested yet')).toBeVisible();
        await expect(page.getByText('External Channel Is Configured but Quiet')).toBeVisible();
        await page.getByRole('button', { name: 'Send a Test Message' }).click();
        await expect(page.getByText('Test message sent')).toBeVisible();
        await expect(page.getByText(/connected to @e2e_fake_bot/)).toBeVisible();
        await telegram(request, 'bad');
        await page.reload();
        await page.getByRole('button', { name: 'Send a Test Message' }).click();
        await expect(page.getByText('Test failed')).toBeVisible();
    });

    test('a failed load is an error, not an empty state', async ({ page }) => {
        await page.route(/\/api\/notifications\?(log=true&)?limit=200/, (r) => r.fulfill({ status: 500, json: { error: 'database is down', kind: 'internal_error' } }));
        await goto(page, '/notifications', { allow: [/500|Internal Server Error/] });
        await expect(page.getByRole('alert')).toContainText('Could not load notifications: database is down');
        await expect(page.getByText('No External Channel Yet')).toHaveCount(0);
    });

    test('Notification Settings goes to the settings tab; Refresh refetches', async ({ page }) => {
        await goto(page, '/notifications');
        insertNotifications([{ event_type: 'reminder', message: 'Arrived while looking', kind: 'system', external_status: 'sent' }]);
        await page.getByRole('button', { name: 'Refresh notifications' }).click();
        await expect(logRow(page, 'Arrived while looking')).toBeVisible();
        await page.getByRole('button', { name: 'Notification Settings' }).click();
        await expect(page).toHaveURL(/\/settings\?tab=notifications$/);
    });
});

test.describe('/notifications — In-App Feed', () => {
    test('pills count and filter by kind; the needs-you alert counts them', async ({ page }) => {
        insertNotifications([
            { event_type: 'agent_error', message: 'Needs one', kind: 'needs_you', item_id: 'ETM-1' },
            // The needs_you rule: a workflow park whose item (ETM-1, in progress) has moved on is stale.
            { event_type: 'workflow_run', message: 'Stale park', kind: 'needs_you', item_id: 'ETM-1' },
            { event_type: 'jira_sync', message: 'Needs two', kind: 'needs_you' },
            { event_type: 'agent_completed_no_item', message: 'An update', kind: 'update' },
            { event_type: 'autofetch_success', message: 'A system row', kind: 'system', project_id: 'e2e-terminal-project' },
            { event_type: 'mcp_external', message: 'Log only', kind: 'system', in_app: false, external_status: 'sent' },
        ]);
        await goto(page, '/notifications?tab=in-app');
        await expect(page.getByRole('alert')).toContainText('2 items need you.');
        await expect(feedCard(page, 'Needs one')).toContainText('Needs you');
        await expect(feedCard(page, 'Stale park')).toHaveCount(0);
        sql(`UPDATE items SET status = 'waiting_for_info' WHERE id = 'ETM-1'`);
        await page.reload();
        await expect(feedCard(page, 'Stale park')).toBeVisible();
        await expect(page.getByRole('alert')).toContainText('3 items need you.');
        sql(`UPDATE items SET status = 'in_progress' WHERE id = 'ETM-1'`);
        await page.reload();
        await expect(feedCard(page, 'Stale park')).toHaveCount(0);
        const pills = page.getByRole('group', { name: 'Filter notifications' });
        for (const [name, n, rows] of [
            ['Needs You', 2, ['Needs one', 'Needs two']],
            ['Updates', 1, ['An update']],
            ['System', 1, ['A system row']],
            ['All', 4, ['Needs one', 'Needs two', 'An update', 'A system row']],
        ] as const) {
            const pill = pills.getByRole('button', { name: new RegExp(`^${name}`) });
            await expect(pill).toContainText(String(n));
            await pill.click();
            await expect(page.getByTestId('notification-card')).toHaveCount(rows.length);
            for (const r of rows) await expect(feedCard(page, r)).toBeVisible();
        }
        sql(`DELETE FROM notifications WHERE kind = 'needs_you'`);
        await page.reload();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await pills.getByRole('button', { name: /^Needs You/ }).click();
        await expect(page.getByText('Nothing here yet.')).toBeVisible();
        sql(`DELETE FROM notifications`);
        insertNotifications([{ event_type: 'jira_sync', message: 'Only one', kind: 'needs_you' }]);
        await page.reload();
        await expect(page.getByRole('alert')).toContainText('1 item needs you.');
    });

    test('Load more pages the feed 200 at a time, on both tabs', async ({ page }) => {
        sql(`INSERT INTO notifications (event_type, message, kind, external_status, sent_external, created_at)
             SELECT 'reminder', 'Paged row ' || g, 'system', 'sent', 1, now() - (g || ' minutes')::interval FROM generate_series(1, 205) g`);
        await goto(page, '/notifications?tab=in-app');
        await expect(page.getByTestId('notification-card')).toHaveCount(200);
        await expect(feedCard(page, 'Paged row 200')).toBeVisible();
        await expect(page.getByText('Paged row 201', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Load more' }).click();
        await expect(page.getByTestId('notification-card')).toHaveCount(205);
        await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
        // The Log pages its own rows (every outward send, stale or not).
        await page.getByRole('tab', { name: 'Notification Log' }).click();
        await expect(page.getByTestId('notification-log-row')).toHaveCount(200);
        await page.getByRole('button', { name: 'Load more' }).click();
        await expect(page.getByTestId('notification-log-row')).toHaveCount(205);
        await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
        await expect(page.getByRole('group', { name: 'Filter deliveries' }).getByRole('button', { name: /^Sent/ })).toContainText('205');
    });

    test('a reminder card snoozes from the feed and offers the way to Reminders', async ({ page, request }) => {
        const r = await apiPost<{ id: number }>(request, '/api/reminders', {
            label: 'Feed snooze',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
            channel: 'notification',
        });
        insertNotifications([{ event_type: 'reminder', message: 'Feed snooze', kind: 'system', reminder_id: r.id, link_url: '/reminders' }]);
        await goto(page, '/notifications?tab=in-app');
        const card = feedCard(page, 'Feed snooze');
        await expect(card).not.toHaveAttribute('role', 'button');
        await card.getByRole('button', { name: 'Snooze reminder' }).click();
        await page.getByRole('menuitem', { name: 'Snooze 1 hour' }).click();
        await expect(page.getByText(/^Snoozed until /)).toBeVisible();
        await expect.poll(async () => (await apiGet<{ next_fire_at: string }>(request, `/api/reminders/${r.id}`)).next_fire_at).not.toBe('');
        const after = await apiGet<{ next_fire_at: string }>(request, `/api/reminders/${r.id}`);
        expect(Math.abs(new Date(after.next_fire_at).getTime() - (Date.now() + 3_600_000))).toBeLessThan(120_000);
        await expect(card.getByText('Unread')).toHaveCount(0);
        await card.getByRole('button', { name: 'Snooze reminder' }).click();
        await page.getByRole('menuitem', { name: 'Open Reminders' }).click();
        await expect(page).toHaveURL(/\/reminders$/);
        await request.delete(`${API}/api/reminders/${r.id}`);
        await request.delete(`${API}/api/reminders/${r.id}?hard=1`);
    });
});

test.describe('/notifications — badge, popover, Mark All Read', () => {
    test('Mark All Read empties the sidenav badge and the topbar popover', async ({ page }) => {
        insertNotifications([
            { event_type: 'jira_sync', message: 'Unread one', kind: 'needs_you' },
            { event_type: 'reminder', message: 'Unread two', kind: 'system' },
            { event_type: 'agent_completed_no_item', message: 'Unread three' },
            { event_type: 'reminder', message: 'Already read', kind: 'system', read: true },
        ]);
        await goto(page, '/notifications?tab=in-app');
        await expect(badge(page)).toContainText('3');
        await page.getByRole('button', { name: 'Notifications', exact: true }).click();
        const pop = page.getByRole('dialog', { name: 'Notifications status' });
        await expect(pop.getByTestId('popover-unread')).toHaveText('3 unread notifications');
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);

        await page.getByRole('button', { name: 'Mark All Read' }).click();
        await expect(page.getByText('Marked 3 notifications read')).toBeVisible();
        await expect(badge(page)).not.toContainText(/\d/);
        await expect(page.getByRole('button', { name: /^Unread:/ })).toHaveCount(0);
        await page.getByRole('button', { name: 'Notifications', exact: true }).click();
        await expect(pop.getByTestId('popover-unread')).toHaveText('No unread notifications');
        await pop.getByRole('link', { name: 'Settings' }).click();
        await expect(page).toHaveURL(/\/settings\?tab=notifications$/);
        await page.getByRole('button', { name: 'Notifications', exact: true }).click();
        await page.getByRole('dialog', { name: 'Notifications status' }).getByRole('link', { name: 'Open notifications' }).click();
        await expect(page).toHaveURL(/\/notifications\?tab=in-app$/);

        // Nothing left to mark.
        await page.getByRole('button', { name: 'Mark All Read' }).click();
        await expect(page.getByText('Marked 0 notifications read')).toBeVisible();
    });

    test('the popover names the provider and whether it was tested', async ({ page, request }) => {
        await telegram(request, 'good-token');
        await goto(page, '/notifications');
        await page.getByRole('button', { name: 'Notifications', exact: true }).click();
        const pop = page.getByRole('dialog', { name: 'Notifications status' });
        await expect(pop).toContainText('Sending via Telegram');
        await expect(pop).toContainText('Set up, not tested yet.');
        await page.keyboard.press('Escape');
        await telegram(request, null);
        await page.reload();
        await page.getByRole('button', { name: 'Notifications', exact: true }).click();
        await expect(pop).toContainText('No external channel');
    });
});

test.describe('/notifications — live', () => {
    test.describe.configure({ timeout: 120_000 });

    test('a workflow park arrives over SSE with the badge; the reply that moves the item on drops it', async ({ page, request }) => {
        await goto(page, '/notifications?tab=in-app');
        await expect(page.getByText('Nothing here yet.')).toBeVisible();
        await expect(badge(page)).not.toContainText(/\d/);

        const stamp = Date.now();
        const wf = await createWorkflow(request, `E2E park ${stamp}`, chainGraph({ type: 'owner' }));
        const task = await createTask(request, `E2E needs-you ${stamp}`);
        const queued = await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
        expect(queued.status(), await queued.text()).toBeLessThan(300);
        await apiPost(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });

        // No reload: the row and the badge arrive on their own.
        const parked = page.getByTestId('notification-card').filter({ hasText: task.id }).filter({ hasText: 'Needs you' });
        await expect(parked).toBeVisible({ timeout: 30_000 });
        await expect(badge(page)).toContainText('1');
        await expect(page.getByRole('alert')).toContainText('1 item needs you.');

        // The Owner replies: the run resumes, the Task moves on, the stale row goes.
        await apiPost(request, '/api/comments', { author: 'owner', issue_type: 'task', issue_id: task.id, body: 'Looks good, carry on.' });
        await expect(parked).toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect.poll(async () => (await apiGet<{ status: string }>(request, `/api/tasks/${task.id}`)).status).toBe('done');
    });
});

test.describe('/notifications — outward delivery from real producers', () => {
    test.describe.configure({ timeout: 150_000 });
    test.beforeEach(async ({ request }) => {
        await telegram(request, 'good-token');
        await quietNow(request, false);
        await request.patch(`${API}/api/settings/notifications`, { data: { external_notification_event_toggles: {} } });
    });
    test.afterEach(async ({ request }) => {
        await request.patch(`${API}/api/settings/notifications`, { data: { external_notification_event_toggles: {} } });
    });

    async function parkThenReply(request: APIRequestContext, name: string) {
        const wf = await createWorkflow(request, name, chainGraph({ type: 'owner' }));
        const task = await createTask(request, `${name} task`);
        const queued = await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
        expect(queued.status(), await queued.text()).toBeLessThan(300);
        await apiPost(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });
        await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
        await apiPost(request, '/api/comments', { author: 'owner', issue_type: 'task', issue_id: task.id, body: 'Carry on.' });
        await expect.poll(async () => (await apiGet<{ status: string }>(request, `/api/tasks/${task.id}`)).status, { timeout: 30_000 }).toBe('done');
        return task;
    }

    test('a park and the finish both reach Telegram verbatim, markdown-ish characters and all', async ({ page, request }) => {
        // `_`, `*` and `[` unbalanced: Telegram's Markdown parser rejected exactly this.
        const name = `E2E_out *${Date.now()} [x`;
        const task = await parkThenReply(request, name);
        await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(2);
        const bodies = sent.map((b) => JSON.parse(b) as { text: string; parse_mode?: string });
        expect(bodies.every((b) => b.parse_mode === undefined)).toBe(true);
        expect(bodies[0]!.text).toContain(`${name} needs you on ${task.id}`);
        expect(bodies[1]!.text).toContain(`${name} finished ${task.id}`);

        await goto(page, '/notifications');
        await expect(logRow(page, `${name} needs you`)).toContainText('Sent');
        await expect(logRow(page, `${name} finished`)).toContainText('Sent');
    });

    test('a finish whose toggle is off stays in the log as Skipped, naming the toggle, and Send now sends it', async ({ page, request }) => {
        await request.patch(`${API}/api/settings/notifications`, { data: { external_notification_event_toggles: { 'workflow.finished': false } } });
        const name = `E2E skip ${Date.now()}`;
        await parkThenReply(request, name);
        await goto(page, '/notifications');
        const row = logRow(page, `${name} finished`);
        await expect(row).toContainText('Skipped');
        await expect(row).toContainText('"Task Finished" is turned off in Settings');
        expect(sent).toHaveLength(1); // the park only
        await row.getByRole('button', { name: /Send now/ }).click();
        await expect(row).toContainText('Sent');
        expect(sent).toHaveLength(2);
    });

    test('Settings lists every outward event with its own switch', async ({ page }) => {
        await goto(page, '/settings?tab=notifications');
        for (const title of ['Task Finished', 'Agent Run Failed (no item)', 'CI Failed', 'Auto-fetch Failed', 'Reminders', 'Workflow Failed', 'Jira Sync Failed']) {
            await expect(page.getByRole('main').getByText(title, { exact: true })).toBeVisible();
        }
    });
});
