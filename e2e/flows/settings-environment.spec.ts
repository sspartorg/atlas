import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, E2E_ENV_FILE } from '../helpers/api.js';

// Settings → Environment and Help & About. The e2e API writes a scratch env
// file (ATLAS_ENV_FILE in global-setup), never the developer's .env.

const DEFAULT_FEEDBACK = 'https://github.com/sspartorg/atlas/issues';
const envFile = () => readFileSync(E2E_ENV_FILE, 'utf8');

test.afterAll(async ({ request }) => {
    await request.patch(`${API}/api/settings/env`, {
        data: { updates: [{ key: 'ATLAS_LOG_LEVEL', value: 'error' }, { key: 'ATLAS_FEEDBACK_URL', value: DEFAULT_FEEDBACK }] },
    });
});

test('edit, revert and save both variables; the env file follows', async ({ page }) => {
    await goto(page, '/settings?tab=environment');
    const save = page.getByRole('button', { name: /Save Changes/ });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/only take effect after the API process restarts/)).toHaveCount(0);

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'debug', exact: true }).click();
    await expect(page.getByText('unsaved changes', { exact: true })).toBeVisible();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'error', exact: true }).click();
    await expect(save).toBeDisabled();

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'warn', exact: true }).click();
    const url = page.getByRole('textbox').last();
    await url.fill('https://example.test/bugs');
    await save.click();
    await expect(page.getByText('no unsaved changes')).toBeVisible();
    await expect.poll(envFile).toContain('ATLAS_LOG_LEVEL=warn');
    expect(envFile()).toContain('ATLAS_FEEDBACK_URL=https://example.test/bugs');

    // Edit again.
    await page.reload();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'info', exact: true }).click();
    await page.getByRole('button', { name: /Save Changes/ }).click();
    await expect.poll(envFile).toContain('ATLAS_LOG_LEVEL=info');
});

test('Help & About: links point where they say; the feedback URL follows the env var and restores', async ({ page, request }) => {
    await request.patch(`${API}/api/settings/env`, { data: { updates: [{ key: 'ATLAS_FEEDBACK_URL', value: 'mailto:bugs@example.test' }] } });
    await goto(page, '/settings?tab=help');
    const href = (name: RegExp) => page.getByRole('link', { name }).first().getAttribute('href');
    expect(await href(/release notes/)).toBe('https://github.com/sspartorg/atlas/releases/tag/v1.0.0');
    expect(await href(/Open on GitHub/)).toBe('https://github.com/sspartorg/atlas');
    expect(await href(/Open docs/)).toBe('https://github.com/sspartorg/atlas/tree/main/docs');
    expect(await href(/sspart\.org@gmail\.com/)).toBe('mailto:sspart.org@gmail.com');
    for (const l of await page.locator('a[href^="https://"]').all()) await expect(l).toHaveAttribute('target', '_blank');

    await expect(page.getByRole('link', { name: 'Email a bug report' })).toHaveAttribute('href', 'mailto:bugs@example.test');
    await page.getByRole('button', { name: /Restore recommended URL/ }).click();
    await expect(page.getByRole('link', { name: 'Open GitHub Issues' })).toHaveAttribute('href', DEFAULT_FEEDBACK);
    await expect.poll(envFile).toContain(`ATLAS_FEEDBACK_URL=${DEFAULT_FEEDBACK}`);
});

test('the API refuses to write protected keys', async ({ request }) => {
    const res = await request.patch(`${API}/api/settings/env`, { data: { updates: [{ key: 'DATABASE_URL', value: 'x' }] } });
    expect(res.status()).toBe(400);
    expect(envFile()).not.toContain('DATABASE_URL=x');
});
