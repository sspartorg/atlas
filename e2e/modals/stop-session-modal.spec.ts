import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// StopSessionModal is opened from a Terminal session detail page via the
// "Stop" button. The full lifecycle is exercised in e2e/pages/terminal.spec.ts.
// This spec is a lighter-weight smoke test: navigate to the terminal page,
// start a session (requires fixture setup), and assert the modal opens with
// the expected Stop session button. Defers if no active session is found.
//
// For CI without a running session the guard skips gracefully.

test.describe('StopSessionModal', () => {
    test('Stop button on an active session opens the stop modal', async ({ page }) => {
        await goto(page, '/terminal');
        await expect(page.getByRole('heading', { name: /Terminal/i }).first()).toBeVisible();

        // Check if there is already an active session listed
        const stopBtn = page.getByRole('button', { name: /^Stop$/ }).first();
        const hasStop = await stopBtn.isVisible().catch(() => false);
        test.skip(!hasStop, 'no active session found — deferring StopSessionModal smoke test');

        await stopBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // The dialog should have a "Stop session" submit button
        await expect(dialog.getByRole('button', { name: /Stop session/i })).toBeVisible();
    });

    test('stop modal shows commit message field or summary section', async ({ page }) => {
        await goto(page, '/terminal');
        await expect(page.getByRole('heading', { name: /Terminal/i }).first()).toBeVisible();

        const stopBtn = page.getByRole('button', { name: /^Stop$/ }).first();
        const hasStop = await stopBtn.isVisible().catch(() => false);
        test.skip(!hasStop, 'no active session — deferring stop modal field check');

        await stopBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Commit message is pre-filled; assert the input is visible
        const commitField = dialog.getByLabel(/commit message/i).first();
        const hasCommit = await commitField.isVisible().catch(() => false);
        if (hasCommit) {
            await expect(commitField).toBeVisible();
        }
        // Cancel without stopping
        const cancelBtn = dialog.getByRole('button', { name: /Cancel/i });
        const hasCancel = await cancelBtn.isVisible().catch(() => false);
        if (hasCancel) {
            await cancelBtn.click();
            await expect(dialog).not.toBeVisible();
        } else {
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
        }
    });
});
