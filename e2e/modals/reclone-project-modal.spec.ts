import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ADR 0018 — re-clone is per repo, so the modal opens from Project Detail's
// Repos tab → the repo's row menu → "Re-clone from remote". The e2e seed
// inserts "E2E Terminal" (id: e2e-terminal-project) with one repo, `project`.
// We never click "Stash & re-clone" — Cancel or Esc only.

const PROJECT_ID = 'e2e-terminal-project';

async function openReclone(page: import('@playwright/test').Page) {
    await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
    await page.getByRole('button', { name: /Actions for project/i }).first().click();
    await page.getByRole('menuitem', { name: /Re-clone from remote/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

test.describe('RecloneProjectModal', () => {
    test('open from the Repos tab — repo actions → Re-clone from remote', async ({ page }) => {
        const dialog = await openReclone(page);
        // FormHeading renders as <p>. Confirm view shows this text.
        await expect(dialog.getByText('Re-clone from remote?', { exact: true })).toBeVisible();
    });

    test('confirm view — repo chip and git status table visible', async ({ page }) => {
        const dialog = await openReclone(page);
        // The chip names the repo being re-cloned.
        await expect(dialog.getByText(/project/i).first()).toBeVisible();
        // Status table rows: "Local HEAD", "Remote HEAD", "Behind", "Uncommitted".
        await expect(dialog.getByText('Local HEAD', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Uncommitted', { exact: true })).toBeVisible();
    });

    test('Esc closes the modal without re-cloning', async ({ page }) => {
        const dialog = await openReclone(page);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
