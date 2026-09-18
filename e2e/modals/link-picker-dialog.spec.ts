import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// LinkPickerDialog is a search-style dialog for linking items together,
// opened from a detail page's "Add related item" (+) menu. The e2e seed
// creates sub-task ETM-2 under Task ETM-1.

test.describe('LinkPickerDialog', () => {
    async function openPicker(page: Parameters<typeof goto>[0]) {
        await goto(page, '/sub-tasks/ETM-2');
        await expect(page.getByText('ETM-2').first()).toBeVisible();
        await page.getByRole('button', { name: 'Add related item' }).click();
        await page.getByRole('menuitem', { name: /Add relates-to/ }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        return dialog;
    }

    test('LinkPickerDialog opens from item detail and shows a search input', async ({ page }) => {
        const dialog = await openPicker(page);
        await expect(dialog.getByRole('textbox').first()).toBeVisible();
    });

    test('Esc closes the LinkPickerDialog', async ({ page }) => {
        const dialog = await openPicker(page);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
