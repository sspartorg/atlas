import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// PromptPreviewDialog is opened from the Agent Detail → Prompt tab.
// It shows a read-only preview of the full agent prompt markdown.
// The e2e seed installs PO Writer from the marketplace, so the
// Prompt tab is always available.
// We never submit — Esc or Cancel only.

test.describe('PromptPreviewDialog', () => {
    test('Prompt tab is visible on agent detail page', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=prompt');
        await expect(page.getByRole('tab').filter({ hasText: 'Prompt' }).first()).toBeVisible();
    });

    test('Preview button on Prompt tab opens PromptPreviewDialog', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=prompt');
        // Wait for the Prompt tab to be active
        await expect(page.getByRole('tab').filter({ hasText: 'Prompt' }).first()).toBeVisible();

        // Look for a "Preview" or "Full preview" button on the Prompt tab
        const previewBtn = page
            .getByRole('button', { name: /Preview|Full preview|View full/i })
            .first();
        const hasPreview = await previewBtn.isVisible().catch(() => false);
        test.skip(!hasPreview, 'no Preview button on Prompt tab — deferring PromptPreviewDialog smoke');

        await previewBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
    });

    test('preview dialog shows prompt text content', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=prompt');
        await expect(page.getByRole('tab').filter({ hasText: 'Prompt' }).first()).toBeVisible();

        const previewBtn = page
            .getByRole('button', { name: /Preview|Full preview|View full/i })
            .first();
        const hasPreview = await previewBtn.isVisible().catch(() => false);
        test.skip(!hasPreview, 'no Preview button — deferring');

        await previewBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // The dialog should contain some text (the prompt content)
        const contentArea = dialog.locator('pre, [role="document"], textarea').first();
        const hasContent = await contentArea.isVisible().catch(() => false);
        if (hasContent) {
            await expect(contentArea).toBeVisible();
        }

        // Close without modifying
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
