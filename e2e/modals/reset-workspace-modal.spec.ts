import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ResetWorkspaceModal is opened from Settings → Profile tab → "Reset Workspace"
// button (the red outlined button at the bottom of ProfileTab).
// The modal renders with disableEscapeKeyDown={resetting}, so Esc works while
// the form is idle. We never click "Reset Everything" — that mutates data.

test.describe('ResetWorkspaceModal', () => {
    test('open from Settings Profile tab — Reset Workspace button', async ({ page }) => {
        await goto(page, '/settings');
        // Profile tab is the default; wait for the page content to render.
        await expect(page.getByText('Owner Profile')).toBeVisible();
        await page.getByRole('button', { name: /Reset Workspace/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>, not a heading role.
        await expect(dialog.getByText('Reset all workspace data?', { exact: true })).toBeVisible();
    });

    test('form fields — warning alert and RESET confirmation input visible', async ({ page }) => {
        await goto(page, '/settings');
        await expect(page.getByText('Owner Profile')).toBeVisible();
        await page.getByRole('button', { name: /Reset Workspace/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Warning copy about losing all content.
        await expect(dialog.getByText(/You will lose all content/i)).toBeVisible();
        // The "What you'll lose" section label.
        await expect(dialog.getByText("What you'll lose")).toBeVisible();
        // Confirm text field — placeholder is "RESET".
        await expect(dialog.getByPlaceholder('RESET')).toBeVisible();
    });

    test('Esc closes the modal without submitting', async ({ page }) => {
        await goto(page, '/settings');
        await expect(page.getByText('Owner Profile')).toBeVisible();
        await page.getByRole('button', { name: /Reset Workspace/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
