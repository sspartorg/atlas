import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

const TABS = [
    { label: 'Profile',        key: 'profile'       },
    { label: 'Environment',    key: 'environment'   },
    { label: 'Shared Secrets', key: 'secrets'       },
    { label: 'Model Registry', key: 'models'        },
    { label: 'Notifications',  key: 'notifications' },
] as const;

test.describe('/settings tabs', () => {
    test('each tab is selectable', async ({ page }) => {
        await goto(page, '/settings');

        for (const { label } of TABS) {
            // MUI Tabs may include icon text in the accessible name —
            // use filter({ hasText }) instead of name+exact for stability.
            const tab = page.getByRole('tab').filter({ hasText: label }).first();
            await expect(tab).toBeVisible();
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
    });

    test('deep-link via ?tab=environment activates Environment tab', async ({ page }) => {
        await goto(page, '/settings?tab=environment');
        await expect(
            page.getByRole('tab').filter({ hasText: 'Environment' }).first(),
        ).toHaveAttribute('aria-selected', 'true');
    });

    test('default route selects Profile tab', async ({ page }) => {
        await goto(page, '/settings');
        await expect(
            page.getByRole('tab').filter({ hasText: 'Profile' }).first(),
        ).toHaveAttribute('aria-selected', 'true');
    });
});
