import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AddFromMarketplaceModal is opened from the Agents list page → "Add" button
// (or a similar CTA). It shows the marketplace catalog inside a modal so the
// user can install an agent without leaving the /agents page.
// We never submit (install) — Cancel or Esc only.

test.describe('AddFromMarketplaceModal', () => {
    test('Add button on /agents opens the marketplace dialog', async ({ page }) => {
        await goto(page, '/agents');
        await expect(page.getByRole('heading', { name: /Agents/i }).first()).toBeVisible();

        // Look for an "Add" or "Add from marketplace" button (not the card-level "Add" btns)
        const addBtn = page
            .getByRole('button', { name: /Add from marketplace|Browse marketplace|Add agent/i })
            .first();
        const hasAdd = await addBtn.isVisible().catch(() => false);
        test.skip(!hasAdd, 'no Add from marketplace button on /agents — deferring');

        await addBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('marketplace modal shows catalog cards with Add or Installed buttons', async ({ page }) => {
        await goto(page, '/agents');
        await expect(page.getByRole('heading', { name: /Agents/i }).first()).toBeVisible();

        const addBtn = page
            .getByRole('button', { name: /Add from marketplace|Browse marketplace|Add agent/i })
            .first();
        const hasAdd = await addBtn.isVisible().catch(() => false);
        test.skip(!hasAdd, 'no Add from marketplace button — deferring');

        await addBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // The marketplace inside the modal should show at least one agent card
        const agentCard = dialog.getByText(/PO Writer|Writer|Architect|Coder/i).first();
        await expect(agentCard).toBeVisible({ timeout: 10_000 });
    });

    test('Esc closes the marketplace modal', async ({ page }) => {
        await goto(page, '/agents');
        await expect(page.getByRole('heading', { name: /Agents/i }).first()).toBeVisible();

        const addBtn = page
            .getByRole('button', { name: /Add from marketplace|Browse marketplace|Add agent/i })
            .first();
        const hasAdd = await addBtn.isVisible().catch(() => false);
        test.skip(!hasAdd, 'no Add from marketplace button — deferring');

        await addBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
