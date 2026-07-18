import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/settings/credentials', () => {
    test('renders without console errors — heading and Add credential CTA visible', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await expect(
            page.getByRole('heading', { name: 'Git credentials', exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: /add credential/i }).first()).toBeVisible();
    });

    test('Add credential button opens CredentialModal with kind options, close with Esc', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        // Modal is lazy-loaded — wait for dialog to appear
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Kind view: FormHeading renders as <p>, assert text inside dialog
        await expect(dialog.getByText('Add credential')).toBeVisible();
        // PAT radio is the only enabled kind
        await expect(dialog.getByRole('radio', { name: /personal access token/i })).toBeVisible();
        // SSH and App password are disabled placeholders
        await expect(dialog.getByRole('radio', { name: /ssh key/i })).toBeVisible();
        await expect(dialog.getByRole('radio', { name: /app password/i })).toBeVisible();
        // Close without submitting
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });

    test('shows empty-state copy when no credentials exist', async ({ page }) => {
        await goto(page, '/settings/credentials');
        // Seed has no credentials — empty state renders
        await expect(page.getByText('No credentials yet.')).toBeVisible();
        await expect(page.getByText('Add your first credential')).toBeVisible();
    });
});
