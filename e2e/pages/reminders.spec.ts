import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/reminders', () => {
    test('renders without console errors and shows page heading and CTA', async ({ page }) => {
        await goto(page, '/reminders');
        await expect(page.getByRole('heading', { name: 'Reminders', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /new reminder/i })).toBeVisible();
    });

    test('New reminder button opens modal with Label field and Schedule section', async ({ page }) => {
        await goto(page, '/reminders');
        await page.getByRole('button', { name: /new reminder/i }).click();
        // Dialog title
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog').getByText('New reminder')).toBeVisible();
        // Required Label field
        await expect(page.getByLabel('Label')).toBeVisible();
        // Schedule kind radio group (Once is the default selection)
        await expect(page.getByRole('radio', { name: 'Once' })).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Cron' })).toBeVisible();
        // Close without submitting
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    test('shows empty state when no active reminders exist', async ({ page }) => {
        await goto(page, '/reminders');
        // The seed has no reminders; the empty-state hero should be rendered.
        await expect(page.getByText('No active reminders')).toBeVisible();
        await expect(
            page.getByText(/Use New reminder to add one yourself/i),
        ).toBeVisible();
    });
});
