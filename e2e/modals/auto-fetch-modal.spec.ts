import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AutoFetchScheduleModal is opened from the project card overflow menu on
// /projects. The e2e seed inserts an "E2E Terminal" project (id:
// e2e-terminal-project), so /projects always has at least one card row.

test.describe('AutoFetchScheduleModal', () => {
    test('open from /projects — project actions menu → Auto-fetch schedule…', async ({ page }) => {
        await goto(page, '/projects');
        // Wait for the project list to render.
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        // Open the overflow menu for the first project card.
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        // Click the Auto-fetch schedule menu item.
        await page.getByRole('menuitem', { name: /Auto-fetch schedule/i }).click();
        // Modal is lazy-loaded — wait for dialog.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Header text: "Auto-fetch schedule" (disabled state) or "Auto-fetch enabled".
        // Multiple matches occur (header + body copy + tooltip) — first is enough.
        await expect(dialog.getByText(/Auto-fetch/i).first()).toBeVisible();
    });

    test('form fields — enable switch, schedule presets, and conflict cards visible', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Auto-fetch schedule/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Enable switch row.
        await expect(dialog.getByText('Enable scheduled auto-fetch')).toBeVisible();
        // Schedule preset cards — at minimum "Every hour" should be present.
        await expect(dialog.getByText('Every hour')).toBeVisible();
        // Conflict policy cards.
        await expect(dialog.getByText('Skip & notify')).toBeVisible();
    });

    test('Esc closes the modal without saving', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).first().click();
        await page.getByRole('menuitem', { name: /Auto-fetch schedule/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
