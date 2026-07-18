import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/', () => {
    test('dashboard renders without console errors', async ({ page }) => {
        await goto(page, '/');
        // Dashboard heading or its empty state — the seed gives us 0
        // items so the welcome banner is what renders.
        await expect(page.getByText(/Atlas|Dashboard|Welcome/i).first()).toBeVisible();
    });
});
