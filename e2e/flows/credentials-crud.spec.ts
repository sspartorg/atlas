import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Git credentials: a PAT's full life — add (with commit identity), edit
// twice, replace + reveal the token, delete — plus the mobile Add FAB.

type Cred = { id: string; label: string; scope: string; human_name: string | null; human_email: string | null; token_fingerprint: string | null };
const creds = (request: import('@playwright/test').APIRequestContext) => apiGet<Cred[]>(request, '/api/credentials');

test.afterAll(async ({ request }) => {
    for (const c of await creds(request)) if (c.label.startsWith('e2e-pat')) await request.delete(`${API}/api/credentials/${c.id}`);
});

async function openRowMenu(page: Page, label: string) {
    const row = page.getByText(label, { exact: true }).locator('xpath=ancestor::*[.//button[@aria-label="Credential actions"]][1]');
    await row.getByRole('button', { name: 'Credential actions' }).click();
}

test('PAT: add, edit twice, replace and reveal the token, delete', async ({ page, request }) => {
    await goto(page, '/settings/credentials');
    await page.getByRole('button', { name: /Add credential/ }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel(/^Label/).fill('e2e-pat');
    await d.getByLabel(/^Token/).fill('ghp_e2eFAKEtoken0000000001');
    await d.getByLabel(/Your name/i).fill('E2E Person');
    await d.getByLabel(/Your email/i).fill('e2e@example.com');
    await d.getByRole('button', { name: 'Save credential' }).click();
    await expect(page.getByText('Credential saved')).toBeVisible();
    await page.keyboard.press('Escape');
    const added = (await creds(request)).find((c) => c.label === 'e2e-pat');
    expect(added).toMatchObject({ human_name: 'E2E Person', human_email: 'e2e@example.com' });

    for (const [from, to] of [['e2e-pat', 'e2e-pat-2'], ['e2e-pat-2', 'e2e-pat-3']] as const) {
        await openRowMenu(page, from);
        await page.getByRole('menuitem', { name: 'Edit' }).click();
        await page.getByRole('dialog').getByLabel(/^Label/).fill(to);
        await page.getByRole('dialog').getByLabel(/Repo scope/i).fill(`acme/${to}`);
        await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText('Credential saved')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await creds(request)).find((c) => c.label === to)?.scope).toBe(`acme/${to}`);
    }

    await openRowMenu(page, 'e2e-pat-3');
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByLabel(/^Token/).fill('ghp_e2eFAKEtoken0000000002');
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Credential saved')).toBeVisible();
    await page.keyboard.press('Escape');
    await openRowMenu(page, 'e2e-pat-3');
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /reveal|show/i }).first().click();
    await expect(page.getByRole('dialog').getByLabel(/^Token/)).toHaveValue('ghp_e2eFAKEtoken0000000002');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await openRowMenu(page, 'e2e-pat-3');
    await page.getByRole('menuitem', { name: /Delete credential/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Credential "e2e-pat-3" deleted')).toBeVisible();
    expect((await creds(request)).some((c) => c.label === 'e2e-pat-3')).toBe(false);
});

test('Add credential is a floating button on phones @mobile', async ({ page }) => {
    await goto(page, '/settings/credentials');
    const fab = page.locator('.MuiFab-root');
    await expect(fab).toBeVisible();
    await expect(fab).toHaveAccessibleName('Add credential');
    await fab.click();
    await expect(page.getByRole('dialog')).toBeVisible();
});

test('PAT form validation and the edit Cancel button', async ({ page, request }) => {
    await goto(page, '/settings/credentials');
    await page.getByRole('button', { name: /Add credential/ }).first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Save credential' }).click();
    await expect(d.getByText('Label is required.')).toBeVisible();
    await d.getByLabel(/^Label/).fill('e2e-pat-v');
    await d.getByLabel(/^Token/).fill('short');
    await d.getByRole('button', { name: 'Save credential' }).click();
    await expect(d.getByText(/valid Personal Access Token/)).toBeVisible();
    await d.getByLabel(/^Token/).fill('ghp_e2eFAKEtoken0000000004');
    await d.getByRole('button', { name: 'Save credential' }).click();
    await expect(page.getByText('Credential saved')).toBeVisible();
    await page.keyboard.press('Escape');

    await openRowMenu(page, 'e2e-pat-v');
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByLabel(/^Label/).fill('should-not-save');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await creds(request)).some((c) => c.label === 'should-not-save')).toBe(false);
});

test('GitHub App: a missing folder and a corrupt key are refused before anything is saved', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-bot-'));
    writeFileSync(join(dir, 'app-config.json'), JSON.stringify({ id: 1, slug: 'e2e-bad' }));
    writeFileSync(join(dir, 'bad.pem'), '-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----\n');
    const tryFolder = async (folder: string) => {
        await goto(page, '/settings/credentials', { allow: [/400 \(Bad Request\)/] });
        await page.getByRole('button', { name: /Add credential/ }).first().click();
        await page.getByRole('radio', { name: /GitHub App/i }).click();
        await page.getByRole('button', { name: 'Continue' }).click();
        const d = page.getByRole('dialog');
        await d.getByLabel(/^Label/).fill('e2e-app');
        await d.getByLabel('Bot info folder').fill(folder);
        await d.getByLabel(/Installation owner/i).fill('acme');
        await d.getByRole('button', { name: 'Verify & save' }).click();
    };
    await tryFolder('/definitely/not/here');
    await expect(page.getByText(/bot info folder not found/)).toBeVisible();
    await tryFolder(dir);
    await expect(page.getByText(/not a valid private key/)).toBeVisible();
    expect((await creds(request)).some((c) => c.label === 'e2e-app')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
});

test('deleting the credential team config syncs with warns first', async ({ page, request }) => {
    const created = await (await request.post(`${API}/api/credentials`, { data: { label: 'e2e-pat-team', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000005' } })).json() as Cred;
    await request.put(`${API}/api/team-config`, { data: { role: 'publisher', repo_url: 'https://github.com/acme/team.git', credential_id: created.id } });
    await goto(page, '/settings/credentials');
    await openRowMenu(page, 'e2e-pat-team');
    await page.getByRole('menuitem', { name: /Delete credential/ }).click();
    await expect(page.getByText(/Team config syncs with this credential/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await apiGet<{ credential_id: string | null }>(request, '/api/team-config')).credential_id).toBeNull();
    await request.put(`${API}/api/team-config`, { data: { role: 'off', repo_url: null } });
});

test('credentials are cards on phones: label and actions reachable without sideways scroll @mobile', async ({ page, request }) => {
    await request.post(`${API}/api/credentials`, { data: { label: 'e2e-pat-card', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000006' } });
    await goto(page, '/settings/credentials');
    const menu = page.getByRole('button', { name: 'Credential actions' }).first();
    const box = await menu.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
