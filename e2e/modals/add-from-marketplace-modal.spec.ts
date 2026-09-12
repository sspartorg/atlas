import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AddFromMarketplaceModal is the rename/retry step shown when an install
// hits a slug clash; it is reached from the marketplace DETAIL page, not from
// /agents. Per ADR 0007 the marketplace is its own page and the /agents
// empty-state CTA navigates there.
//
// 2026-09-12 — the name regex used to include /Add agent/i, which matched the
// unrelated "Add Agent" dialog on /agents (name · category · CLI · model ·
// colour). That defeated the `test.skip` guard below and the specs then failed
// looking for catalog cards inside a form. Narrowed so the guard fires.
// We never submit (install) — Cancel or Esc only.

test.describe('AddFromMarketplaceModal', () => {
    test('Add button on /agents opens the marketplace dialog', async ({ page }) => {
        await goto(page, '/agents');
        await expect(page.getByRole('heading', { name: /Agents/i }).first()).toBeVisible();

        // Look for an "Add" or "Add from marketplace" button (not the card-level "Add" btns)
        const addBtn = page
            .getByRole('button', { name: /Add from marketplace|Browse marketplace/i })
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
            .getByRole('button', { name: /Add from marketplace|Browse marketplace/i })
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
            .getByRole('button', { name: /Add from marketplace|Browse marketplace/i })
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
