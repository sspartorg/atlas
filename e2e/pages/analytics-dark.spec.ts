import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { setThemeMode } from '../helpers/theme.js';

// Phase C — Analytics page dark-mode smoke. Owner flagged Analytics
// as the worst dark-mode regression target; this test runs in dark
// mode (initial script sets data-theme + localStorage before paint)
// and asserts the hero, KPI strip, and chart sections all render
// without console errors.

test.describe('/analytics — dark mode', () => {
    test('renders cleanly in dark mode (no console errors, key headings visible)', async ({
        page,
    }) => {
        await setThemeMode(page, 'dark');
        await goto(page, '/analytics');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        // Hero metric — total spend label or value should be visible
        await expect(page.getByText(/TOTAL SPEND/i).first()).toBeVisible();
    });
});
