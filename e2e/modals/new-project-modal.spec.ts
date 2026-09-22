import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('NewProjectModal', () => {
    test('open from /projects — dialog visible with "New project" heading text', async ({ page }) => {
        await goto(page, '/projects');
        // Button only renders on md+ viewport; default Playwright width is 1280
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('New project')).toBeVisible();
    });

    // A project is a wrapper: it holds 0..N equal repos (ADR 0018) and repos
    // are added afterwards from Project Detail's Repos tab. The modal used to
    // bundle a repo URL, a credential, a folder picker and a branch.
    test('asks for name, key and description — and nothing about repos', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        await expect(dialog.getByLabel(/^Name/)).toBeVisible();
        await expect(dialog.getByLabel(/Issue key prefix/)).toBeVisible();
        await expect(dialog.getByLabel(/Description/)).toBeVisible();

        await expect(dialog.getByLabel(/Repository URL/i)).toHaveCount(0);
        await expect(dialog.getByText('Use existing folder')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Clone Repository' })).toHaveCount(0);
    });

    test('Create project is disabled until the key is known to be free', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // With no inputs the button must be disabled — no network mutation occurs.
        await expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled();
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
});
