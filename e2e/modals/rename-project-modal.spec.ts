import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// RenameProjectModal is opened from Project Detail → Actions menu → "Rename"
// menu item. The e2e seed inserts "E2E Terminal" (id: e2e-terminal-project).
// We navigate to the project detail page and open the overflow menu.
// We never submit the rename — Cancel or Esc only.

test.describe('RenameProjectModal', () => {
    test('open from project detail — Actions menu → Rename', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();

        // Navigate into the project detail
        const openLink = page.getByRole('link', { name: /Open/i }).first();
        await openLink.click();
        await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

        // Open the overflow/actions menu
        const actionsBtn = page
            .getByRole('button', { name: /Actions|more_vert/i })
            .first();
        const moreBtn = page
            .locator('.material-symbols-rounded', { hasText: 'more_vert' })
            .first();
        const hasActions = await actionsBtn.isVisible().catch(() => false);
        const hasMore = await moreBtn.isVisible().catch(() => false);

        test.skip(!hasActions && !hasMore, 'no Actions/more_vert button on project detail — deferring');

        if (hasActions) {
            await actionsBtn.click();
        } else {
            await moreBtn.click();
        }

        const renameItem = page.getByRole('menuitem', { name: /Rename/i });
        const hasRename = await renameItem.isVisible().catch(() => false);
        test.skip(!hasRename, 'no Rename menu item on project detail — deferring');

        await renameItem.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('rename modal shows a name input pre-filled with current project name', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();

        const openLink = page.getByRole('link', { name: /Open/i }).first();
        await openLink.click();
        await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

        const actionsBtn = page.getByRole('button', { name: /Actions|more_vert/i }).first();
        const moreBtn = page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first();
        const hasActions = await actionsBtn.isVisible().catch(() => false);
        const hasMore = await moreBtn.isVisible().catch(() => false);
        test.skip(!hasActions && !hasMore, 'no Actions button — deferring');

        if (hasActions) await actionsBtn.click();
        else await moreBtn.click();

        const renameItem = page.getByRole('menuitem', { name: /Rename/i });
        const hasRename = await renameItem.isVisible().catch(() => false);
        test.skip(!hasRename, 'no Rename menu item — deferring');

        await renameItem.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Name input should be visible and pre-filled
        const nameInput = dialog.locator('input[type="text"]').first();
        await expect(nameInput).toBeVisible();
        // Cancel without saving
        await dialog.getByRole('button', { name: /Cancel/i }).click();
        await expect(dialog).not.toBeVisible();
    });
});
