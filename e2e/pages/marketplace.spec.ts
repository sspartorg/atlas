import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// W5 — Marketplace page smoke tests. The marketplace catalog is synced
// by runSeed() so the page shows catalog entries without any installed
// agents. Covers the previously-untested /agents/marketplace route.

test.describe('/agents/marketplace', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await expect(
            page.getByRole('heading', { name: /Agent Marketplace/i }).first()
        ).toBeVisible();
    });

    test('shows the PO Writer catalog card', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        // The catalog is seeded by runSeed() — PO Writer is always present.
        await expect(page.getByText(/PO Writer/i).first()).toBeVisible();
    });

    test('"Add" button is visible on a non-installed catalog card', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        // The e2e seed installs agent-po-writer, so its card shows "Installed".
        // Other catalog cards (Architect, Coder, etc.) show an "Add" button.
        // The marketplace card renders the button as "Add" (not "Install").
        const addBtn = page
            .getByRole('button', { name: /^Add$/i })
            .first();
        await expect(addBtn).toBeVisible();
    });
});
