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
