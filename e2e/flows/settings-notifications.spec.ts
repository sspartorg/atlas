import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Settings → Notifications without sending anything: event toggles persist,
// quiet hours save and refuse a bad time visibly, idle threshold bounds.

type S = { quiet_hours_enabled: number; quiet_hours_from: string | null; terminal_idle_notify_seconds: number; external_notification_event_toggles: string };
const settings = (request: import('@playwright/test').APIRequestContext) => apiGet<S>(request, '/api/settings');

test.afterAll(async ({ request }) => {
    await request.patch(`${API}/api/settings/notifications`, {
        data: { quiet_hours_enabled: 0, quiet_hours_from: '22:00', quiet_hours_to: '08:00', terminal_idle_notify_seconds: 300, external_notification_event_toggles: {} },
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
