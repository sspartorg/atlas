import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// DuplicateAgentModal is opened from the AgentDetail page (/agents/:id) via
// the AgentCardMenu (more_vert overflow) → "Duplicate" menu item. It is also
// reachable from the /agents list page card menus. The e2e seed installs
// agent-po-writer from the marketplace, so /agents/agent-po-writer is always
// available. We never submit — Cancel or Esc only.

test.describe('DuplicateAgentModal', () => {
    test('open from /agents/:id — more_vert menu → Duplicate', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        // Wait for the hero section to load.
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();
        // AgentCardMenu trigger: the more_vert Box — it has no aria-label, so
        // click by icon text content inside it.
        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        await page.getByRole('menuitem', { name: /Duplicate/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>, not heading role — use getByText.
        await expect(dialog.getByText('Duplicate agent?', { exact: true })).toBeVisible();
    });

    test('confirm view — name field, new slug preview, and Cancel button visible', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();
        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        await page.getByRole('menuitem', { name: /Duplicate/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // "New agent name" label and pre-filled name text field.
        await expect(dialog.getByText('New agent name', { exact: true })).toBeVisible();
        await expect(dialog.locator('input[type="text"]')).toBeVisible();
        // Slug preview row shows "New slug" label.
        await expect(dialog.getByText('New slug', { exact: true })).toBeVisible();
        // Cancel button present — we do not submit.
        await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeVisible();
    });

    test('Esc closes the modal without duplicating', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();
        await page.locator('.material-symbols-rounded', { hasText: 'more_vert' }).first().click();
        await page.getByRole('menuitem', { name: /Duplicate/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
