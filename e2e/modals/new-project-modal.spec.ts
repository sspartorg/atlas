import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('NewProjectModal', () => {
    test('open from /projects — dialog visible with "New Project" heading text', async ({ page }) => {
        await goto(page, '/projects');
        // Button only renders on md+ viewport; default Playwright width is 1280
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // FormHeading renders as <p>, not <h2>, so match text inside dialog
        await expect(dialog.getByText('New project')).toBeVisible();
    });

    test('Clone Repository button is disabled until required fields are filled', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // canSubmit requires a valid repo URL, credential, project name, branch, and prefix OK
        // With no inputs the button must be disabled — no network mutation occurs
        const submitBtn = dialog.getByRole('button', { name: 'Clone Repository' });
        await expect(submitBtn).toBeDisabled();
    });

    test('Cancel button closes the dialog', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('Escape key closes the dialog', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });

    test('mode toggle switches heading to "Connect existing folder"', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.getByText('Use existing folder').click();
        await expect(dialog.getByText('Connect existing folder')).toBeVisible();
        // Close without mutating
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
