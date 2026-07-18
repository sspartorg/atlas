import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Notifications page has two tabs controlled via ?tab=
// TAB_KEYS = ['external', 'in-app']; default is 'external'.
// Tab labels: "Notification Log" (external) / "In-App Feed" (in-app).

test.describe('/notifications tabs', () => {
    test('default route selects Notification Log tab', async ({ page }) => {
        await goto(page, '/notifications');
        await expect(
            page.getByRole('heading', { name: /Notifications/i }).first(),
        ).toBeVisible();
        await expect(
            page.getByRole('tab').filter({ hasText: 'Notification Log' }).first(),
        ).toHaveAttribute('aria-selected', 'true');
    });

    test('deep-link ?tab=in-app selects In-App Feed tab', async ({ page }) => {
        await goto(page, '/notifications?tab=in-app');
        await expect(
            page.getByRole('tab').filter({ hasText: 'In-App Feed' }).first(),
        ).toHaveAttribute('aria-selected', 'true');
        // Notification Log must not be selected.
        await expect(
            page.getByRole('tab').filter({ hasText: 'Notification Log' }).first(),
        ).toHaveAttribute('aria-selected', 'false');
    });

    test('deep-link ?tab=external selects Notification Log tab', async ({ page }) => {
        await goto(page, '/notifications?tab=external');
        await expect(
            page.getByRole('tab').filter({ hasText: 'Notification Log' }).first(),
        ).toHaveAttribute('aria-selected', 'true');
    });
});
