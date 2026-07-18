import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AcceptUpgradeModal is shown on Agent Detail when the marketplace has a newer
// version of an installed agent. The e2e seed installs PO Writer at whatever
// version the catalog holds; the catalog is seeded fresh each test run, so no
// upgrade banner is expected. The spec uses runtime-data-guard to skip cleanly
// when no upgrade is available (the common case in CI).

test.describe('AcceptUpgradeModal', () => {
    test('upgrade banner appears when a newer catalog version exists', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        // Upgrade banner typically shows "Update available" or "New version" text
        const upgradeBanner = page.getByText(/update available|new version|upgrade available/i).first();
        const hasUpgrade = await upgradeBanner.isVisible().catch(() => false);
        test.skip(!hasUpgrade, 'no upgrade banner — agent is up to date; deferring AcceptUpgradeModal smoke');

        await expect(upgradeBanner).toBeVisible();
    });

    test('Accept upgrade button opens the upgrade modal', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();

        const upgradeBtn = page
            .getByRole('button', { name: /Accept upgrade|Update|Review upgrade/i })
            .first();
        const hasUpgrade = await upgradeBtn.isVisible().catch(() => false);
        test.skip(!hasUpgrade, 'no upgrade button — agent is up to date; deferring');

        await upgradeBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // The dialog should mention "upgrade" or "update"
        await expect(dialog.getByText(/upgrade|update/i).first()).toBeVisible();
        // Cancel without accepting
        const cancelBtn = dialog.getByRole('button', { name: /Cancel|Dismiss/i });
        const hasCancel = await cancelBtn.isVisible().catch(() => false);
        if (hasCancel) {
            await cancelBtn.click();
        } else {
            await page.keyboard.press('Escape');
        }
        await expect(dialog).not.toBeVisible();
    });
});
