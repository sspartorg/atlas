import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ScriptModal is opened from /guardrails → Scripts tab in two ways:
//   • "Add script" button → add mode (Slug field enabled, title = "Add script")
//   • Clicking an existing script card → edit mode (Slug disabled, title = "Edit script")
//
// The e2e seed inserts at least one guardrail script ("prereqs" / "Worktree
// prereqs") via GUARDRAIL_SCRIPT_SEEDS, so both triggers are always reachable.
//
// We never submit — Cancel or Esc only.

test.describe('ScriptModal', () => {
    async function openScriptsTab(page: Parameters<typeof goto>[0]) {
        await goto(page, '/guardrails');
        // Wait for the page to render (tab row is always present).
        await expect(page.getByText('Guard-rails')).toBeVisible();
        // Switch to the Scripts tab.
        await page.getByRole('tab', { name: /Scripts/i }).click();
        // "Add script" button confirms the tab is active.
        await expect(
            page.getByRole('button', { name: /Add script/i }).first()
        ).toBeVisible();
    }

    test('add-mode form fields — Name and sh body inputs visible', async ({ page }) => {
        await openScriptsTab(page);
        await page.getByRole('button', { name: /Add script/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel(/^Name/i)).toBeVisible();
        await expect(dialog.getByLabel(/\.sh body/i)).toBeVisible();
    });

    test('Cancel closes add-mode modal without saving', async ({ page }) => {
        await openScriptsTab(page);
        await page.getByRole('button', { name: /Add script/i }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // ScriptModal autofocuses the Slug field which absorbs Escape key
        // events in MUI's Dialog — click the explicit Cancel button instead.
        await dialog.getByRole('button', { name: /Cancel/i }).click();
        await expect(dialog).not.toBeVisible();
    });
});
