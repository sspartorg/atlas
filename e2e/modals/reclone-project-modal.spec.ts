import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// RecloneProjectModal is opened from /projects → project row overflow menu →
// "Re-clone from remote" item. The item is hidden on mobile (isMobile guard in
// ProjectRowMenu.tsx), so the test must run at a desktop viewport width. The
// e2e seed inserts "E2E Terminal" (id: e2e-terminal-project).
// We never click "Stash & re-clone" — Cancel or Esc only.

test.describe('RecloneProjectModal', () => {
    test('open from /projects — Project actions → Re-clone from remote', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Re-clone from remote/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>. Confirm view shows this text.
        await expect(dialog.getByText('Re-clone from remote?', { exact: true })).toBeVisible();
    });

    test('confirm view — project chip and git status table visible', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Re-clone from remote/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Project chip shows the project name.
        await expect(dialog.getByText(/E2E Terminal/i)).toBeVisible();
        // Status table rows: "Local HEAD", "Remote HEAD", "Behind", "Uncommitted".
        await expect(dialog.getByText('Local HEAD', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Uncommitted', { exact: true })).toBeVisible();
    });

    test('Esc closes the modal without re-cloning', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Re-clone from remote/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
