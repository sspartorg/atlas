import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// What the Settings pages do when the API errors, the network drops, or two
// tabs edit the same thing. Saves must never look successful when they weren't.

const allow = { allow: [/500|Failed to fetch|ERR_|net::/] };

test('a 500 on a profile save says so and puts the old value back', async ({ page, request }) => {
    const before = (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name;
    await goto(page, '/settings', allow);
    await page.route('**/api/settings/profile', (r) => r.fulfill({ status: 500, json: { error: 'disk full', kind: 'internal_error' } }));
    await page.getByLabel('Display Name').fill('Should not stick');
    await page.getByLabel('Display Name').blur();
    await expect(page.getByText('Could not save')).toBeVisible();
    await expect(page.getByLabel('Display Name')).toHaveValue(before);
});

test('the network dropping mid-save on Shared Secrets reports it and keeps the edit', async ({ page }) => {
    await goto(page, '/settings?tab=secrets', allow);
    await page.getByRole('button', { name: /Add secret/ }).click();
    await page.getByPlaceholder('UPPER_SNAKE_CASE').last().fill('E2E_OFFLINE');
    await page.getByPlaceholder('value').last().fill('v');
    await page.route('**/api/environment-secrets', (r) => (r.request().method() === 'PUT' ? r.abort('internetdisconnected') : r.continue()));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Could not save shared secrets')).toBeVisible();
    await expect(page.getByPlaceholder('UPPER_SNAKE_CASE').last()).toHaveValue('E2E_OFFLINE');
});

test('Environment save failing keeps the draft and the Save button', async ({ page }) => {
    await goto(page, '/settings?tab=environment', allow);
    await page.route('**/api/settings/env', (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: { error: 'nope' } }) : r.continue()));
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'debug', exact: true }).click();
    await page.getByRole('button', { name: /Save Changes/ }).click();
    await expect(page.getByText('unsaved changes', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Changes/ })).toBeEnabled();
});

test('a failed credential delete leaves the row and says why', async ({ page, request }) => {
    await request.post(`${API}/api/credentials`, { data: { label: 'e2e-fail-delete', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000003' } });
    await goto(page, '/settings/credentials', allow);
    await page.route('**/api/credentials/*', (r) => (r.request().method() === 'DELETE' ? r.fulfill({ status: 500, json: { error: 'locked' } }) : r.continue()));
    const row = page.getByText('e2e-fail-delete', { exact: true }).locator('xpath=ancestor::*[.//button[@aria-label="Credential actions"]][1]');
    await row.getByRole('button', { name: 'Credential actions' }).click();
    await page.getByRole('menuitem', { name: /Delete credential/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Could not delete credential')).toBeVisible();
    await expect(page.getByText('e2e-fail-delete', { exact: true })).toBeVisible();
    const c = (await apiGet<{ id: string; label: string }[]>(request, '/api/credentials')).find((x) => x.label === 'e2e-fail-delete');
    if (c) await request.delete(`${API}/api/credentials/${c.id}`);
});

test('two tabs editing the display name: the last save wins and both see it after reload', async ({ browser, request }) => {
    const before = (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name;
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await goto(a, '/settings');
    await goto(b, '/settings');
    await a.getByLabel('Display Name').fill('From tab A');
    await a.getByLabel('Display Name').blur();
    await expect.poll(async () => (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name).toBe('From tab A');
    await b.getByLabel('Display Name').fill('From tab B');
    await b.getByLabel('Display Name').blur();
    await expect.poll(async () => (await apiGet<{ owner_name: string }>(request, '/api/settings')).owner_name).toBe('From tab B');
    await a.reload();
    await expect(a.getByLabel('Display Name')).toHaveValue('From tab B');
    await ctx.close();
    await request.patch(`${API}/api/settings/profile`, { data: { owner_name: before } });
});
