import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// DeleteProjectModal is opened from the project card overflow menu on
// /projects → "Delete" menu item. The e2e seed inserts "E2E Terminal"
// (id: e2e-terminal-project). We never click the destructive submit
// buttons — Cancel or Esc only.

test.describe('DeleteProjectModal', () => {
    test('open from /projects — Project actions menu → Delete', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>, not a heading — use getByText with exact match.
        await expect(dialog.getByText('Delete project?', { exact: true })).toBeVisible();
    });

    test('confirm view — project chip, mode radio options, and Cancel button visible', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Project chip shows the project name.
        await expect(dialog.getByText(/E2E Terminal/i)).toBeVisible();
        // Mode option labels are rendered as Typography — not heading roles.
        await expect(dialog.getByText('Remove from Atlas only', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Delete project and content', { exact: true })).toBeVisible();
        // Cancel button must be reachable without submitting.
        await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeVisible();
    });

    test('Esc closes the modal without deleting', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Delete/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
