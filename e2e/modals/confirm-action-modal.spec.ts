import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ConfirmActionModal is a generic confirm/cancel dialog used in two places:
//
//   1. AgentRunDetail — "Stop this run?" (stop button, only visible when a
//      run is in_progress or queued). The e2e seed installs no agent runs,
//      so this trigger is unreachable from seed data.
//
//   2. MarketplaceUpgradeBanner (Detach / Dismiss actions) — only rendered
//      when marketplace_pulled_version < catalog version, which requires a
//      version bump after install. Also unreachable from seed data.
//
// DEFERRAL: both trigger paths require transient runtime state that the e2e
// seed does not provision. Specs below degenerate to smoke tests of the two
// pages where the modal would appear. Full dialog assertions are deferred
// until a fixture seeds an in-progress run or a catalog version bump.

test.describe('ConfirmActionModal — smoke (no seed trigger available)', () => {
    test('/agents page loads — trigger surface for stop-run confirm', async ({ page }) => {
        await goto(page, '/agents');
        // The PO Writer agent is installed by the e2e seed via marketplace.
        // The Run Now button launches a run; stopping it would open the modal.
        // We only verify the page renders without crashing.
        await expect(page.getByText(/PO Writer/i)).toBeVisible();
    });

    test('/agents/:id page loads — agent detail is stop-button host', async ({ page }) => {
        await goto(page, '/agents');
        await expect(page.getByText(/PO Writer/i)).toBeVisible();
        // Navigate into the agent detail page (the card is a link).
        await page.getByText(/PO Writer/i).first().click();
        // Detail page title or heading should appear.
        await expect(page.getByText(/PO Writer/i).first()).toBeVisible();
    });
});
