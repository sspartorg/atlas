import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// StartSessionDialog is opened from /terminal via the "Start Session"
// contained-green button in the header (or the empty-state primary action
// when no sessions exist). The spec exercises the dialog's open / form-
// fields-visible / cancel surface — it does NOT submit (submit would
// spawn a real PTY against the fake-claude binary and is exercised by
// e2e/pages/terminal.spec.ts).

test.describe('StartSessionDialog', () => {
    test('open from /terminal — Start Session button reveals dialog', async ({ page }) => {
        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('form fields — Project + Model selects and optional Title/Branch/Prompt visible', async ({ page }) => {
        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Project + Model are required selects; the rest are optional inputs.
        await expect(dialog.getByLabel(/^Project/)).toBeVisible();
        await expect(dialog.getByLabel(/^Model/)).toBeVisible();
        await expect(dialog.getByLabel(/^Title \(optional\)/)).toBeVisible();
        await expect(dialog.getByLabel(/^Branch name \(optional\)/)).toBeVisible();
        await expect(dialog.getByLabel(/^Initial prompt \(optional\)/)).toBeVisible();
    });

    test('Esc closes the dialog without starting a session', async ({ page }) => {
        await goto(page, '/terminal');
        await page.getByRole('button', { name: /Start Session/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
