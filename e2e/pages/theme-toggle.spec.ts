import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Phase C — theme toggle persistence test. Navigates to Settings,
// flips Light↔Dark via the Appearance toggle, reloads, and asserts
// the chosen mode survives across reload (data-theme attribute + the
// localStorage key the FOUC-prevention script reads).

test.describe('/settings — Appearance toggle', () => {
    test('Dark mode persists after reload', async ({ page }) => {
        await goto(page, '/settings');
        // The Appearance row has two radio-button-style chips: Light, Dark.
        const darkBtn = page.getByRole('radio', { name: /Dark/i });
        await expect(darkBtn).toBeVisible();
        await darkBtn.click();
        // Verify data-theme attribute flipped
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        // Reload the page — the FOUC-prevention inline script in index.html
        // should restore dark mode from localStorage BEFORE React mounts.
        // W5 fix: Atlas opens an SSE EventSource on every page, so
        // 'networkidle' never fires. Use 'load' instead (matches the
        // goto() helper default).
        await page.reload({ waitUntil: 'load' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        // Restore to light for following tests in this worker
        const lightBtn = page.getByRole('radio', { name: /Light/i });
        await lightBtn.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });
});
