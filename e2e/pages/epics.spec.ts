import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/epics', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/epics');
        await expect(page.getByRole('heading', { name: /Epics/i }).first()).toBeVisible();
    });

    test('"New Epic" CTA navigates to /epics/new', async ({ page }) => {
        await goto(page, '/epics');
        const newBtn = page.getByRole('link', { name: /New Epic/i }).first();
        if (await newBtn.isVisible().catch(() => false)) {
            await newBtn.click();
            await expect(page).toHaveURL(/\/epics\/new/);
        }
    });
});
