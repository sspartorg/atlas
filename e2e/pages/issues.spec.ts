import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/issues', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/issues');
        await expect(page.getByRole('heading', { name: /Issues/i }).first()).toBeVisible();
    });
});
