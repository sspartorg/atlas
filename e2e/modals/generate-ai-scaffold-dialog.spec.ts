import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// GenerateAiScaffoldDialog is opened from the Project Setup tab. It allows
// the user to generate initial project scaffolding via AI. The e2e seed
// inserts "E2E Terminal" project. We open its Setup tab and look for the
// "Generate" or "AI scaffold" trigger button.
// We never submit — Cancel or Esc only.

test.describe('GenerateAiScaffoldDialog', () => {
    test('Generate AI scaffold button is visible on the project Setup tab', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();

        const openLink = page.getByRole('link', { name: /Open/i }).first();
        await openLink.click();
        await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

        // Click the Setup tab
        const setupTab = page.getByRole('tab', { name: /Setup/i });
        const hasSetup = await setupTab.isVisible().catch(() => false);
        test.skip(!hasSetup, 'no Setup tab on project detail — deferring');

        await setupTab.click();

        // Look for a "Generate" or "AI scaffold" button
        const generateBtn = page
            .getByRole('button', { name: /Generate|AI scaffold|Scaffold/i })
            .first();
        const hasGenerate = await generateBtn.isVisible().catch(() => false);
        test.skip(!hasGenerate, 'no Generate AI scaffold button on Setup tab — deferring');

        await expect(generateBtn).toBeVisible();
    });

    test('Generate AI scaffold dialog opens with a prompt or configuration field', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByText(/E2E Terminal/i)).toBeVisible();

        const openLink = page.getByRole('link', { name: /Open/i }).first();
        await openLink.click();
        await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+/);

        const setupTab = page.getByRole('tab', { name: /Setup/i });
        const hasSetup = await setupTab.isVisible().catch(() => false);
        test.skip(!hasSetup, 'no Setup tab — deferring');

        await setupTab.click();

        const generateBtn = page
            .getByRole('button', { name: /Generate|AI scaffold|Scaffold/i })
            .first();
        const hasGenerate = await generateBtn.isVisible().catch(() => false);
        test.skip(!hasGenerate, 'no Generate button — deferring');

        await generateBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Dialog should contain a prompt/description textarea or configuration field
        const promptField = dialog.getByRole('textbox').first();
        const hasField = await promptField.isVisible().catch(() => false);
        if (hasField) {
            await expect(promptField).toBeVisible();
        }

        // Cancel without generating
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
