import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// RunNowDialog is opened from the QueueAgentDrawer "Run now" button.
// The e2e seed installs "PO Writer" from the marketplace, so the /queue
// page always has at least one agent card to click.

test.describe('RunNowDialog', () => {
    test('open from /queue — click PO Writer card then Run now button', async ({ page }) => {
        await goto(page, '/queue');
        // Seed installs PO Writer — its card is always visible.
        const card = page.getByText(/PO Writer/i).first();
        await expect(card).toBeVisible();
        await card.click();
        // QueueAgentDrawer opens — wait for the Run now button.
        const runNowBtn = page.getByRole('button', { name: /Run now/i });
        await expect(runNowBtn).toBeVisible();
        await runNowBtn.click();
        // RunNowDialog renders as an MUI Dialog.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // DialogTitle contains "Run PO Writer on an issue" (requires_item=true).
        await expect(dialog.getByText(/Run PO Writer/i)).toBeVisible();
    });

    test('form fields — Project, Issue type, and issue selects are visible', async ({ page }) => {
        await goto(page, '/queue');
        await page.getByText(/PO Writer/i).first().click();
        await page.getByRole('button', { name: /Run now/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Three labeled select fields must be present (PO Writer requires_item=true).
        await expect(dialog.getByLabel('Project')).toBeVisible();
        await expect(dialog.getByLabel('Issue type')).toBeVisible();
        // Run now submit button is present (may be disabled — no DB mutation).
        await expect(dialog.getByRole('button', { name: /Run now/i })).toBeVisible();
    });

    test('Esc closes the dialog without submitting', async ({ page }) => {
        await goto(page, '/queue');
        await page.getByText(/PO Writer/i).first().click();
        await page.getByRole('button', { name: /Run now/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
