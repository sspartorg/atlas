import { tmpdir } from 'node:os';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Settings → Profile: every field, edited twice, checked after reload.

type S = { owner_name: string; accent_color: string; workspace_path: string };
const settings = (r: APIRequestContext) => apiGet<S>(r, '/api/settings');
let orig: S;

test.beforeAll(async ({ request }) => {
    orig = await settings(request);
});
test.afterAll(async ({ request }) => {
    await request.patch(`${API}/api/settings/profile`, {
        data: { owner_name: orig.owner_name, accent_color: orig.accent_color, workspace_path: orig.workspace_path },
    });
});

test('display name: Enter and blur save, blank reverts, capped at 100, unicode kept', async ({ page, request }) => {
    await goto(page, '/settings');
    const name = page.getByLabel('Display Name');
    await name.fill('E2E Owner');
    await name.press('Enter');
    await expect.poll(async () => (await settings(request)).owner_name).toBe('E2E Owner');
    await page.reload();
    await page.getByLabel('Display Name').fill('Ünïcødé 名前 👋');
    await page.getByLabel('Display Name').blur();
    await expect.poll(async () => (await settings(request)).owner_name).toBe('Ünïcødé 名前 👋');

    await page.getByLabel('Display Name').fill('   ');
    await page.getByLabel('Display Name').blur();
    await expect(page.getByLabel('Display Name')).toHaveValue('Ünïcødé 名前 👋');

    await page.getByLabel('Display Name').fill('x'.repeat(150));
    await expect(page.getByLabel('Display Name')).toHaveValue('x'.repeat(100));
});

test('accent: two picks persist across reload', async ({ page, request }) => {
    await goto(page, '/settings');
    const swatches = page.getByRole('button', { name: /^Accent / });
    await swatches.nth(1).click();
    const first = await expect.poll(async () => (await settings(request)).accent_color).not.toBe(orig.accent_color);
    void first;
    const a1 = (await settings(request)).accent_color;
    await swatches.nth(3).click();
    await expect.poll(async () => (await settings(request)).accent_color).not.toBe(a1);
    const a2 = (await settings(request)).accent_color;
    await page.reload();
    await expect(page.getByText(new RegExp(`^${a2} · `, 'i'))).toBeVisible();
});

test('theme: dark survives a reload, then back to light', async ({ page }) => {
    await goto(page, '/settings');
    const group = page.getByRole('radiogroup', { name: 'Theme mode' });
    await group.getByRole('radio', { name: /Dark/ }).click();
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('atlas.themeMode'))).toBe('dark');
    await expect(page.getByRole('radiogroup', { name: 'Theme mode' }).getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radiogroup', { name: 'Theme mode' }).getByRole('radio', { name: /Light/ }).click();
    expect(await page.evaluate(() => localStorage.getItem('atlas.themeMode'))).toBe('light');
});

test('workspace folder: typing saves once with the exact value; Browse picks a folder', async ({ page, request }) => {
    await goto(page, '/settings', { allow: [/404/] });
    const patches: string[] = [];
    page.on('request', (r) => {
        if (r.method() === 'PATCH' && r.url().includes('/settings/profile')) patches.push(r.postData() ?? '');
    });
    const field = page.getByLabel('Workspace Folder');
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially('/tmp/e2e-ws', { delay: 30 });
    await expect.poll(async () => (await settings(request)).workspace_path).toBe('/tmp/e2e-ws');
    expect(patches).toHaveLength(1);

    // Browse from a folder that exists, step into nothing, and take it.
    await field.fill(tmpdir());
    await expect.poll(async () => (await settings(request)).workspace_path).toBe(tmpdir());
    await page.getByRole('button', { name: /Browse/ }).click();
    await page.getByRole('button', { name: 'Use this folder' }).click();
    await expect(page.getByRole('button', { name: 'Use this folder' })).toHaveCount(0);
    await expect.poll(async () => (await settings(request)).workspace_path).toContain(tmpdir().split('/').pop()!);
});

test('Manage credentials goes to the credentials page', async ({ page }) => {
    await goto(page, '/settings');
    await page.getByRole('button', { name: /Manage credentials/ }).click();
    await expect(page).toHaveURL(/\/settings\/credentials$/);
});
