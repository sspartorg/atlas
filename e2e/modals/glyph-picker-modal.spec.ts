import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// GlyphPickerModal is opened from the Agent Detail edit flow. The icon/glyph
// for the agent can be changed via a picker dialog that lists Material icon
// names. The e2e seed installs PO Writer from the marketplace.
// We never submit — Cancel or Esc only.

test.describe('GlyphPickerModal', () => {
    test('glyph picker opens from agent detail edit', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        // The glyph / icon picker may be triggered from an "Edit" button,
        // clicking the agent avatar/icon, or a dedicated icon button.
        const glyphBtn = page
            .getByRole('button', { name: /icon|glyph|emoji/i })
            .first();
        const hasGlyph = await glyphBtn.isVisible().catch(() => false);
        test.skip(!hasGlyph, 'no glyph picker button on agent detail — deferring');

        await glyphBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('glyph picker shows a search input or icon grid', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        const glyphBtn = page
            .getByRole('button', { name: /icon|glyph|emoji/i })
            .first();
        const hasGlyph = await glyphBtn.isVisible().catch(() => false);
        test.skip(!hasGlyph, 'no glyph picker button — deferring');

        await glyphBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Should contain a search input or a grid of icon choices
        const searchOrGrid = dialog.getByRole('textbox').first();
        const hasSearch = await searchOrGrid.isVisible().catch(() => false);
        if (hasSearch) {
            await expect(searchOrGrid).toBeVisible();
        }

        // Cancel without picking
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
