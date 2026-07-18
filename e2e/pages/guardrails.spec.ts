import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/guardrails', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/guardrails');
        await expect(page.getByRole('heading', { name: /Guard-?rails/i }).first()).toBeVisible();
    });
});
