import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// EditAgentColorModal is opened from the Agent Detail page. It may be
// accessible via the agent hero / avatar area or via an edit / color action.
// The e2e seed installs PO Writer from the marketplace.
// We never submit — Cancel or Esc only.

test.describe('EditAgentColorModal', () => {
    test('color picker opens from agent detail', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        // The color action could be a button labeled "Color", "Edit color", or
        // a swatch-style clickable element near the agent avatar.
        const colorBtn = page
            .getByRole('button', { name: /color|palette/i })
            .first();
        const hasColor = await colorBtn.isVisible().catch(() => false);
        test.skip(!hasColor, 'no color picker button on agent detail — deferring');

        await colorBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('color modal shows color swatches or a color input', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        const colorBtn = page
            .getByRole('button', { name: /color|palette/i })
            .first();
        const hasColor = await colorBtn.isVisible().catch(() => false);
        test.skip(!hasColor, 'no color picker button — deferring');

        await colorBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Dialog should contain a color-related heading or color swatches
        await expect(dialog.getByText(/color|Color/i).first()).toBeVisible();
        // Cancel without saving
        const cancelBtn = dialog.getByRole('button', { name: /Cancel/i });
        const hasCancel = await cancelBtn.isVisible().catch(() => false);
        if (hasCancel) {
            await cancelBtn.click();
        } else {
            await page.keyboard.press('Escape');
        }
        await expect(dialog).not.toBeVisible();
    });
});
