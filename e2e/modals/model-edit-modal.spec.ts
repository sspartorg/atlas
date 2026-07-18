import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ModelEditModal is opened from Settings → Model Registry tab → "Add model"
// button. The tab value is "models"; navigate with ?tab=models query param.
// The modal opens in "add mode" (model=null), showing an editable Model name
// field and a Note textarea. We never submit — Cancel or Esc only.

test.describe('ModelEditModal', () => {
    test('open from Settings Model Registry tab — Add model button', async ({ page }) => {
        await goto(page, '/settings?tab=models');
        // Wait for the Add model button to mount (Model Registry tab is lazy).
        const addBtn = page.getByRole('button', { name: /Add model/i }).first();
        await expect(addBtn).toBeVisible({ timeout: 10_000 });
        await addBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // The dialog heading text varies; verifying the dialog is visible is
        // sufficient — the form-field assertions in test 2 cover specifics.
    });

    test('form fields — Model name input and Note textarea visible', async ({ page }) => {
        await goto(page, '/settings?tab=models');
        await page.getByRole('button', { name: /Add model/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // "Model name" label is a Typography sibling above the TextField.
        await expect(dialog.getByText('Model name', { exact: true })).toBeVisible();
        // "Note" label.
        await expect(dialog.getByText('Note', { exact: true })).toBeVisible();
        // Note textarea placeholder text.
        await expect(dialog.getByPlaceholder(/Optional/i)).toBeVisible();
    });

    test('Esc closes the modal without saving', async ({ page }) => {
        await goto(page, '/settings?tab=models');
        await page.getByRole('button', { name: /Add model/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
