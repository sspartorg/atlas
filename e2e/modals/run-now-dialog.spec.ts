import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// RunNowDialog is opened from the AgentDetail hero "Run now" button. Since
// ADR 0014 it only starts a project-level run (no item pickers) — item runs
// belong to workflows. The e2e seed installs "PO Writer" from the marketplace.

async function openDialog(page: Parameters<typeof goto>[0]) {
    await goto(page, '/agents/agent-po-writer');
    await page.getByRole('button', { name: /Run now/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

test.describe('RunNowDialog', () => {
    test('opens from the agent detail hero with the agent name in the title', async ({ page }) => {
        const dialog = await openDialog(page);
        await expect(dialog.getByText(/Run PO Writer/i)).toBeVisible();
    });

    test('no item pickers — only Preview prompt and Run now actions', async ({ page }) => {
        const dialog = await openDialog(page);
        await expect(dialog.getByLabel('Project')).toHaveCount(0);
        await expect(dialog.getByLabel('Issue type')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: /Preview prompt/i })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Run now/i })).toBeVisible();
    });

    test('Esc closes the dialog without submitting', async ({ page }) => {
        const dialog = await openDialog(page);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
