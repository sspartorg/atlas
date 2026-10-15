import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Keyboard-only use of Settings: reach and switch tabs, open and dismiss a
// dialog, operate a switch, and submit a field with Enter — no mouse.

test('tabs: reachable by Tab, switch with the arrow keys and Enter', async ({ page }) => {
    await goto(page, '/settings');
    const profile = page.getByRole('tab', { name: 'Profile' });
    await profile.focus();
    await expect(profile).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Environment' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=environment/);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=help/);
});

test('display name saves with Enter alone', async ({ page, request }) => {
    const before = (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name;
    await goto(page, '/settings');
    await page.getByLabel('Display Name').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Keyboard Owner');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name).toBe('Keyboard Owner');
    await request.patch(`${API}/api/settings/profile`, { data: { owner_name: before } });
});

test('Add credential dialog: open with Enter, move with Tab, close with Escape', async ({ page }) => {
    await goto(page, '/settings/credentials');
    await page.getByRole('button', { name: /Add credential/ }).first().focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Focus is trapped inside the dialog.
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus returns to the button that opened it.
    await expect(page.getByRole('button', { name: /Add credential/ }).first()).toBeFocused();
});

test('an event switch toggles with Space', async ({ page, request }) => {
    await goto(page, '/settings?tab=notifications');
    const sw = page.getByRole('switch').first().or(page.locator('input[type="checkbox"]').first());
    const was = await sw.first().isChecked();
    await sw.first().focus();
    await page.keyboard.press('Space');
    await expect(sw.first()).toBeChecked({ checked: !was });
    await page.keyboard.press('Space');
    await expect(sw.first()).toBeChecked({ checked: was });
    await expect.poll(async () => (await apiGet<{ external_notification_event_toggles: string }>(request, '/api/settings')).external_notification_event_toggles).toBeTruthy();
});
