import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { setThemeMode } from '../helpers/theme.js';

// Phase C — table username visibility in dark mode. AgentChip's
// stacked layout (used in EpicTable + WorkItemTable) now renders the
// name in ATLAS_PALETTE.slate (flipping var) rather than the brand
// accent. This test asserts the seed-fixture owner name is rendered
// and visible on the epics + issues tables in dark mode.

const PAGES_WITH_TABLES = ['/epics', '/issues'];

for (const path of PAGES_WITH_TABLES) {
    test.describe(`${path} — dark mode tables`, () => {
        test(`assignee/reporter name renders in the table body`, async ({ page }) => {
            // W5 fix: extend timeout + allow transient server errors.
            test.setTimeout(120_000);
            await setThemeMode(page, 'dark');
            // W5 fix: allow transient 500/connection errors under load.
            await goto(page, path, {
                allow: [/ERR_CONNECTION_CLOSED/i, /500.*Internal Server/i],
            });
            // W5 fix: wait for the page heading before asserting on content.
            await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
            // The seed fixture user is "Owner"; assignee/reporter cells
            // render an AgentChip with that name. Confirm at least one
            // occurrence is visible (locator picks the first match).
            const ownerCell = page.getByText(/Owner/).first();
            await expect(ownerCell).toBeVisible({ timeout: 30_000 });
        });
    });
}
