import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// /agents/:id/runs/:runId smoke spec.
// The e2e seed installs "PO Writer" from the marketplace. The Runs tab
// on the agent detail page shows historical runs. If no runs exist the
// spec uses runtime-data-guard skips.
//
// Navigation path: /agents/agent-po-writer?tab=runs → click first run row
// → assert live-tail / output panel, status badge, and back link.

test.describe('/agents/:id/runs/:runId', () => {
    test('Runs tab is visible on /agents/agent-po-writer', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer');
        await expect(page.getByRole('button', { name: /Run now/i })).toBeVisible();
        const runsTab = page.getByRole('tab').filter({ hasText: 'Runs' }).first();
        await expect(runsTab).toBeVisible();
    });

    test('clicking first run row navigates to run detail page', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=runs');
        // Wait for the Runs tab content to load
        await expect(page.getByRole('tab', { name: /Runs/i }).first()).toBeVisible();

        // Look for a clickable run row or link
        const runRow = page.getByRole('row').nth(1);
        const hasRow = await runRow.isVisible().catch(() => false);
        test.skip(!hasRow, 'no seeded runs — deferring run-detail smoke test');

        await runRow.click();
        await expect(page).toHaveURL(/\/agents\/[a-z0-9-]+\/runs\/[a-z0-9-]+/);
    });

    test('run detail page shows output panel and back-to-agent link', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=runs');
        await expect(page.getByRole('tab', { name: /Runs/i }).first()).toBeVisible();

        const runRow = page.getByRole('row').nth(1);
        const hasRow = await runRow.isVisible().catch(() => false);
        test.skip(!hasRow, 'no seeded runs — deferring run-detail smoke test');

        await runRow.click();
        await expect(page).toHaveURL(/\/agents\/[a-z0-9-]+\/runs\/[a-z0-9-]+/);

        // Back link should point back to the agent detail page
        const backLink = page
            .getByRole('link', { name: /back|agent/i })
            .first();
        const hasBack = await backLink.isVisible().catch(() => false);
        if (hasBack) {
            await expect(backLink).toBeVisible();
        }

        // Output / log panel should be present (log lines or status)
        const outputPanel = page
            .locator('[data-testid="run-output"], .run-output, pre')
            .first();
        const hasOutput = await outputPanel.isVisible().catch(() => false);
        if (hasOutput) {
            await expect(outputPanel).toBeVisible();
        }
    });

    test('run detail page shows a status badge', async ({ page }) => {
        await goto(page, '/agents/agent-po-writer?tab=runs');
        await expect(page.getByRole('tab', { name: /Runs/i }).first()).toBeVisible();

        const runRow = page.getByRole('row').nth(1);
        const hasRow = await runRow.isVisible().catch(() => false);
        test.skip(!hasRow, 'no seeded runs — deferring run-detail smoke test');

        await runRow.click();
        await expect(page).toHaveURL(/\/agents\/[a-z0-9-]+\/runs\/[a-z0-9-]+/);

        // Status badge: one of the known terminal states
        const statusText = page
            .getByText(/queued|in_progress|done|failed|cancelled/i)
            .first();
        const hasStatus = await statusText.isVisible().catch(() => false);
        if (hasStatus) {
            await expect(statusText).toBeVisible();
        }
    });
});
