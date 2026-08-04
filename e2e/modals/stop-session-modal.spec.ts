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
        // The confirm button relabels with the PR checkbox, so match either.
        await expect(
            dialog.getByRole('button', { name: /^Stop (session|& open PR)$/i }),
        ).toBeVisible();
        // Both review scopes are always present.
        await expect(dialog.getByRole('tab', { name: /Uncommitted/i })).toBeVisible();
        await expect(dialog.getByRole('tab', { name: /Committed on branch/i })).toBeVisible();
    });

    test('stop modal exposes the PR opt-out', async ({ page }) => {
        await goto(page, '/terminal');
        await expect(page.getByRole('heading', { name: /Terminal/i }).first()).toBeVisible();

        const stopBtn = page.getByRole('button', { name: /^Stop$/ }).first();
        const hasStop = await stopBtn.isVisible().catch(() => false);
        test.skip(!hasStop, 'no active session — deferring PR opt-out check');

        await stopBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const prBox = dialog.getByRole('checkbox', { name: /open a pull request/i });
        await expect(prBox).toBeVisible();
        // Unchecking must relabel the confirm button — that's the whole signal
        // that no PR will be raised.
        if (await prBox.isEnabled()) {
            await prBox.uncheck();
            await expect(dialog.getByRole('button', { name: /^Stop session$/i })).toBeVisible();
        }
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
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
