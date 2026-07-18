import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/notifications', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/notifications');
        await expect(page.getByRole('heading', { name: /Notifications/i }).first()).toBeVisible();
    });
});
