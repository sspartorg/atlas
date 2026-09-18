import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AddPrLinkDialog is opened from a sub-task's RelatedItemsCard via its
// "Add PR link" button. The e2e seed creates sub-task ETM-2 under Task ETM-1.
// Validates the URL field and that submit is disabled until a URL is typed.

test.describe('AddPrLinkDialog', () => {
    async function openDialog(page: Parameters<typeof goto>[0]) {
        await goto(page, '/sub-tasks/ETM-2');
        await expect(page.getByText('ETM-2').first()).toBeVisible();
        await page.getByRole('button', { name: 'Add PR link', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        return dialog;
    }

    test('Add PR link dialog opens from sub-task detail with URL field', async ({ page }) => {
        const dialog = await openDialog(page);
        await expect(dialog.getByLabel(/URL/i).first()).toBeVisible();
    });

    test('URL field is required — submit disabled while empty', async ({ page }) => {
        const dialog = await openDialog(page);
        await expect(dialog.getByRole('button', { name: 'Add link', exact: true })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
