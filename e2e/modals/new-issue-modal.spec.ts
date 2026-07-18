import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('NewIssueModal', () => {
    test('opens from /issues "New issue" button — dialog and heading visible', async ({ page }) => {
        await goto(page, '/issues');
        await page.getByRole('button', { name: 'New issue' }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('New story', { exact: true })).toBeVisible();
    });

    test('kind tabs — Story, Bug, Sub-task, Sub-bug labels rendered in dialog', async ({ page }) => {
        await goto(page, '/issues');
        await page.getByRole('button', { name: 'New issue' }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Each kind label is rendered as text inside the dialog (kind
        // toggle UI). Selector type varies by MUI variant — assert text
        // visibility rather than clicking, which is what matters for
        // the user-facing surface.
        for (const label of ['Story', 'Bug', 'Sub-task', 'Sub-bug']) {
            await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible();
        }

        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });

    test('validation — submitting empty form surfaces required-field errors', async ({ page }) => {
        await goto(page, '/issues');
        await page.getByRole('button', { name: 'New issue' }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
        // Title and description errors must appear after submit attempt.
        await expect(dialog.getByText('Title is required.', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Description is required.', { exact: true })).toBeVisible();

        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('Esc key closes the modal', async ({ page }) => {
        await goto(page, '/issues');
        await page.getByRole('button', { name: 'New issue' }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
