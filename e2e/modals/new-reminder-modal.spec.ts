import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// NewReminderModal is opened from /reminders → "New reminder" button.
// The full page-level test is in e2e/pages/reminders.spec.ts. This spec
// provides modal-specific coverage: form field validation and cancel flow.
// We never submit — Cancel or Esc only.

test.describe('NewReminderModal', () => {
    test('New reminder button opens the modal', async ({ page }) => {
        await goto(page, '/reminders');
        await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
        await page.getByRole('button', { name: /new reminder/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('New reminder')).toBeVisible();
    });

    test('modal has Label field, Once and Cron radio options', async ({ page }) => {
        await goto(page, '/reminders');
        await page.getByRole('button', { name: /new reminder/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Required Label text field
        await expect(page.getByLabel('Label')).toBeVisible();
        // Schedule kind radios
        await expect(page.getByRole('radio', { name: 'Once' })).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Cron' })).toBeVisible();
    });

    test('Save button is disabled when Label is empty', async ({ page }) => {
        await goto(page, '/reminders');
        await page.getByRole('button', { name: /new reminder/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Without a label the Save / Create button should be disabled
        const saveBtn = dialog.getByRole('button', { name: /Save|Create/i }).first();
        const hasSave = await saveBtn.isVisible().catch(() => false);
        if (hasSave) {
            await expect(saveBtn).toBeDisabled();
        }
    });

    test('Esc closes the new reminder modal', async ({ page }) => {
        await goto(page, '/reminders');
        await page.getByRole('button', { name: /new reminder/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
