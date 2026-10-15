import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Settings → Shared Secrets: add, edit twice, rename, validation, delete —
// and the secrets bundle round trip (export → change → import restores).

const secretValue = async (request: import('@playwright/test').APIRequestContext, key: string) => {
    const res = await request.get(`${API}/api/environment-secrets/${key}/value`);
    return res.ok() ? ((await res.json()) as { value: string }).value : null;
};

test.afterAll(async ({ request }) => {
    await request.put(`${API}/api/environment-secrets`, { data: { vars: [] } });
});

test.describe('Shared secrets', () => {
    test('add, edit twice, rename, validate and delete', async ({ page, request }) => {
        await request.put(`${API}/api/environment-secrets`, { data: { vars: [] } });
        await goto(page, '/settings?tab=secrets');
        const save = page.getByRole('button', { name: 'Save', exact: true });

        await page.getByRole('button', { name: /Add secret/ }).click();
        await page.getByPlaceholder('UPPER_SNAKE_CASE').fill('e2e_token');
        await expect(page.getByPlaceholder('UPPER_SNAKE_CASE')).toHaveValue('E2E_TOKEN');
        await expect(page.getByText('"E2E_TOKEN" needs a value')).toBeVisible();
        await expect(save).toBeDisabled();
        await page.getByPlaceholder('value').fill('one');
        await save.click();
        await expect.poll(() => secretValue(request, 'E2E_TOKEN')).toBe('one');

        for (const next of ['two', 'three']) {
            await page.reload();
            await page.getByPlaceholder(/click Reveal/).fill(next);
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect.poll(() => secretValue(request, 'E2E_TOKEN')).toBe(next);
        }

        await page.reload();
        await page.getByPlaceholder('UPPER_SNAKE_CASE').fill('E2E_RENAMED');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => secretValue(request, 'E2E_RENAMED')).toBe('three');
        expect(await secretValue(request, 'E2E_TOKEN')).toBeNull();

        await page.getByRole('button', { name: /Add secret/ }).click();
        await page.getByPlaceholder('UPPER_SNAKE_CASE').last().fill('E2E_RENAMED');
        await page.getByPlaceholder('value').last().fill('x');
        await expect(page.getByText(/is duplicated/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Delete this secret' }).last().click();

        await page.getByRole('button', { name: 'Delete this secret' }).click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(async () => (await apiGet<{ vars: unknown[] }>(request, '/api/environment-secrets')).vars).toHaveLength(0);
    });

    test('export, change, import restores the value; a wrong passphrase changes nothing', async ({ page, request }) => {
        await request.put(`${API}/api/environment-secrets`, { data: { vars: [{ key: 'E2E_BUNDLE', value: 'original' }] } });
        await goto(page, '/settings');
        const pass = 'e2e-passphrase-1';

        await page.getByRole('button', { name: /Export all secrets/ }).click();
        await page.getByLabel('Passphrase', { exact: true }).fill(pass);
        await page.getByLabel('Confirm passphrase').fill(pass);
        const download = page.waitForEvent('download');
        await page.getByRole('dialog').getByRole('button', { name: 'Export' }).click();
        const file = await (await download).path();
        expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ format: 'atlas-secrets', version: 1 });

        await request.put(`${API}/api/environment-secrets`, { data: { vars: [{ key: 'E2E_BUNDLE', value: 'changed' }] } });

        const importWith = async (passphrase: string) => {
            await page.getByRole('button', { name: /Import secrets/ }).click();
            await page.getByLabel('Secrets file').setInputFiles(file);
            await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
            await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
        };
        await importWith('wrong-passphrase');
        await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Wrong passphrase');
        expect(await secretValue(request, 'E2E_BUNDLE')).toBe('changed');
        await page.keyboard.press('Escape');

        await importWith(pass);
        await expect(page.getByText('Secrets imported')).toBeVisible();
        await expect.poll(() => secretValue(request, 'E2E_BUNDLE')).toBe('original');
    });
});

test('secrets: unicode values round-trip; reveal shows them; export passphrase rules', async ({ page, request }) => {
    await request.put(`${API}/api/environment-secrets`, { data: { vars: [] } });
    await goto(page, '/settings?tab=secrets');
    await page.getByRole('button', { name: /Add secret/ }).click();
    await page.getByPlaceholder('UPPER_SNAKE_CASE').fill('E2E_UNICODE');
    await page.getByPlaceholder('value').fill('pässwörd 🔑 = "quoted" & <tag>');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => secretValue(request, 'E2E_UNICODE')).toBe('pässwörd 🔑 = "quoted" & <tag>');
    await page.reload();
    await page.getByRole('button', { name: /Reveal/ }).first().click();
    await expect(page.locator('input[value="pässwörd 🔑 = \\"quoted\\" & <tag>"]')).toBeVisible();

    await goto(page, '/settings');
    await page.getByRole('button', { name: /Export all secrets/ }).click();
    const exportBtn = page.getByRole('dialog').getByRole('button', { name: 'Export' });
    await page.getByLabel('Passphrase', { exact: true }).fill('short');
    await page.getByLabel('Confirm passphrase').fill('short');
    await expect(exportBtn).toBeDisabled();
    await page.getByLabel('Passphrase', { exact: true }).fill('long enough one');
    await page.getByLabel('Confirm passphrase').fill('long enough two');
    await expect(exportBtn).toBeDisabled();
});

test('import refuses a JSON file that is not a bundle, and a non-JSON file', async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-import-'));
    writeFileSync(join(dir, 'other.json'), '{"hello":1}');
    writeFileSync(join(dir, 'garbage.json'), 'not json');
    await goto(page, '/settings');
    for (const f of ['other.json', 'garbage.json']) {
        await page.getByRole('button', { name: /Import secrets/ }).click();
        await page.getByLabel('Secrets file').setInputFiles(join(dir, f));
        await page.getByLabel('Passphrase', { exact: true }).fill('whatever-pass');
        await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
        await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not an Atlas secrets file');
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    rmSync(dir, { recursive: true, force: true });
});
