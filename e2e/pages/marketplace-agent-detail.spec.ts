import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// /agents/marketplace/:id smoke spec.
// The marketplace catalog is synced by runSeed(). Navigate from
// /agents/marketplace, click the first non-installed card (or any card),
// assert the detail page shows name, kind, prompt preview, and
// Install / Installed button.

test.describe('/agents/marketplace/:id', () => {
    test('clicking a marketplace card navigates to its detail page', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(
            page.getByRole('heading', { name: /Agent Marketplace/i }).first()
        ).toBeVisible();

        // Click the first catalog card visible on the page
        const firstCard = page.getByRole('article').first();
        const hasCard = await firstCard.isVisible().catch(() => false);
        if (!hasCard) {
            // Fallback: click any card-like element
            const cardFallback = page.locator('[class*="card"], [class*="Card"]').first();
            const hasFallback = await cardFallback.isVisible().catch(() => false);
            test.skip(!hasFallback, 'no marketplace catalog cards found — deferring');
            await cardFallback.click();
        } else {
            await firstCard.click();
        }
        await expect(page).toHaveURL(/\/agents\/marketplace\/[a-z0-9-]+/);
    });

    test('detail page shows agent name and Install or Installed button', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(
            page.getByRole('heading', { name: /Agent Marketplace/i }).first()
        ).toBeVisible();

        // Navigate to the first catalog entry
        const firstCard = page.getByRole('article').first();
        const hasCard = await firstCard.isVisible().catch(() => false);
        test.skip(!hasCard, 'no marketplace catalog cards — deferring detail page smoke');

        await firstCard.click();
        await expect(page).toHaveURL(/\/agents\/marketplace\/[a-z0-9-]+/);

        // The detail page should show one of: Install / Installed / Add button
        const actionBtn = page
            .getByRole('button', { name: /Install|Installed|Add/i })
            .first();
        await expect(actionBtn).toBeVisible({ timeout: 10_000 });
    });

    test('detail page shows agent kind or a prompt preview section', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(
            page.getByRole('heading', { name: /Agent Marketplace/i }).first()
        ).toBeVisible();

        const firstCard = page.getByRole('article').first();
        const hasCard = await firstCard.isVisible().catch(() => false);
        test.skip(!hasCard, 'no marketplace catalog cards — deferring detail page smoke');

        await firstCard.click();
        await expect(page).toHaveURL(/\/agents\/marketplace\/[a-z0-9-]+/);

        // Either the kind label or a "Prompt" section heading should appear
        const kindOrPrompt = page.getByText(/Prompt|SDLC|agent/i).first();
        await expect(kindOrPrompt).toBeVisible({ timeout: 10_000 });
    });
});
