import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/scratch-pad', () => {
    test('renders page heading and empty-state without console errors', async ({ page }) => {
        await goto(page, '/scratch-pad');
        await expect(page.getByRole('heading', { name: 'Scratch Pad', exact: true })).toBeVisible();
        // Seed has no tiles so the empty-state copy should show
        await expect(page.getByText(/no scratch pad tiles yet/i)).toBeVisible();
    });

    test('New tile button is visible and enabled', async ({ page }) => {
        await goto(page, '/scratch-pad');
        // Desktop viewport (default 1280px) — the contained button is rendered
        const btn = page.getByRole('button', { name: /new tile/i }).first();
        await expect(btn).toBeVisible();
        await expect(btn).toBeEnabled();
    });

    test('empty-state describes autosave behaviour', async ({ page }) => {
        await goto(page, '/scratch-pad');
        await expect(
            page.getByText(/tiles autosave every 5 seconds while open/i),
        ).toBeVisible();
    });
});
