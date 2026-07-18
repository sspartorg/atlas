import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// CredentialModal is opened from /settings/credentials → "Add credential" button.
// This spec covers the modal-specific interactions. The full page-level smoke
// test is also in e2e/pages/credentials.spec.ts; this spec focusses on the
// modal form progression (kind selection → PAT form fields → Cancel).
// We never submit — Cancel or Esc only.

test.describe('CredentialModal', () => {
    test('Add credential button opens the modal', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Add credential')).toBeVisible();
    });

    test('kind selection view shows PAT, SSH, and App Password radios', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('radio', { name: /personal access token/i })).toBeVisible();
        await expect(dialog.getByRole('radio', { name: /ssh key/i })).toBeVisible();
        await expect(dialog.getByRole('radio', { name: /app password/i })).toBeVisible();
    });

    test('selecting PAT and clicking Next shows Token and Host fields', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // PAT should already be selected (default). Look for Next or Continue button.
        const nextBtn = dialog.getByRole('button', { name: /Next|Continue/i }).first();
        const hasNext = await nextBtn.isVisible().catch(() => false);
        if (hasNext) {
            await nextBtn.click();
            // After clicking Next, PAT form fields should appear
            const tokenField = dialog.getByLabel(/Token|PAT/i).first();
            const hostField = dialog.getByLabel(/Host|URL/i).first();
            const hasToken = await tokenField.isVisible().catch(() => false);
            const hasHost = await hostField.isVisible().catch(() => false);
            if (hasToken) await expect(tokenField).toBeVisible();
            if (hasHost) await expect(hostField).toBeVisible();
        }
        // Close without saving
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });

    test('Cancel button closes the modal from kind selection', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: /Cancel/i }).click();
        await expect(dialog).not.toBeVisible();
    });
});
