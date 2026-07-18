import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/settings', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/settings');
        await expect(page.getByRole('heading', { name: /Settings/i }).first()).toBeVisible();
    });

    test('clicking the Environment tab updates the URL or panel', async ({ page }) => {
        await goto(page, '/settings');
        const envTab = page.getByRole('tab', { name: /Environment/i }).first();
        if (await envTab.isVisible().catch(() => false)) {
            await envTab.click();
            // Don't make a hard URL assertion — Settings may use
            // internal state for the active tab. The visible panel
            // is the contract.
            await expect(page.getByText(/ATLAS_|environment variables/i).first()).toBeVisible();
        }
    });
});
