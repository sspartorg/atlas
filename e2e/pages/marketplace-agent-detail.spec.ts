import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// /agents/marketplace/:id smoke spec. The catalog is synced by runSeed() and
// the e2e seed installs PO Writer from it (fixtures/run-seed.ts).

test.describe('/agents/marketplace/:id', () => {
    test('clicking a marketplace card navigates to its detail page', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(page.getByRole('heading', { name: /Agent Marketplace/i }).first()).toBeVisible();
        // Cards are clickable boxes with no role; the name is inside the click target.
        await page.getByText('PO Writer', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/agents\/marketplace\/agent-po-writer$/);
    });

    test('an installed entry shows its name and "Open installed agent"', async ({ page }) => {
        await goto(page, '/agents/marketplace/agent-po-writer');
        await expect(page.getByRole('heading', { name: 'PO Writer' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Open installed agent/ })).toBeVisible();
    });

    test('detail page shows the quality checklist', async ({ page }) => {
        await goto(page, '/agents/marketplace/agent-po-writer');
        await expect(page.getByText('Quality checklist').first()).toBeVisible();
    });
});
