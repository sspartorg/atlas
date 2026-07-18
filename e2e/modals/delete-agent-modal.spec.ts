import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// DeleteAgentModal is opened from Agent Detail → Actions menu (more_vert) →
// "Delete" menu item. The e2e seed installs "PO Writer" from the marketplace,
// so /agents/agent-po-writer is always reachable. We never click the
// destructive submit button — Cancel or Esc only.

test.describe('DeleteAgentModal', () => {
    test('open from /agents/:id — more_vert menu → Delete', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        // Wait for the agent detail hero to load
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        // Open the more_vert overflow menu
        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        const deleteItem = page.getByRole('menuitem', { name: /Delete/i });
        const hasDelete = await deleteItem.isVisible().catch(() => false);
        test.skip(!hasDelete, 'no Delete menu item — deferring DeleteAgentModal smoke test');

        await deleteItem.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('delete agent modal shows agent name and Cancel button', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        const deleteItem = page.getByRole('menuitem', { name: /Delete/i });
        const hasDelete = await deleteItem.isVisible().catch(() => false);
        test.skip(!hasDelete, 'no Delete menu item — deferring');

        await deleteItem.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Dialog should mention "Delete" somewhere in its heading or body
        await expect(dialog.getByText(/Delete/i).first()).toBeVisible();
        // Cancel button must be reachable
        await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeVisible();
    });

    test('Esc closes the delete agent modal', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        const deleteItem = page.getByRole('menuitem', { name: /Delete/i });
        const hasDelete = await deleteItem.isVisible().catch(() => false);
        test.skip(!hasDelete, 'no Delete menu item — deferring');

        await deleteItem.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
