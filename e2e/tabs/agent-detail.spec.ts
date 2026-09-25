import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Tab key → URL param value (from TAB_KEYS in AgentDetail.tsx)
const TABS = [
    { label: 'Overview',    key: 'overview'    },
    { label: 'Prompt',      key: 'prompt'      },
    { label: 'Tests',       key: 'tests'       },
    { label: 'Performance', key: 'performance' },
    { label: 'Runs',        key: 'runs'        },
    { label: 'Memory',      key: 'memory'      },
] as const;

/** Navigate to /agents, click the PO Writer card, return the resolved URL. */
async function gotoPoWriter(page: Parameters<typeof goto>[0]): Promise<string> {
    await goto(page, '/agents');
    const card = page.getByText(/PO Writer/i).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/agents\/[a-z0-9-]+/);
    return page.url();
}

test.describe('/agents/:id tabs', () => {
    test('every tab is reachable, selected', async ({ page }) => {
        const baseUrl = await gotoPoWriter(page);
        // Strip any existing ?tab= so we start from a clean base URL
        const agentUrl = baseUrl.split('?')[0];

        for (const { label, key } of TABS) {
            await goto(page, `${agentUrl}?tab=${key}`);
            // MUI Tabs with `iconPosition="start"` include the icon's text
            // content in the accessible name. Use `.filter({ hasText })`
            // (substring) rather than `name: label, exact: true`.
            const tab = page.getByRole('tab').filter({ hasText: label }).first();
            await expect(tab).toBeVisible();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
    });

    test('a stale ?tab=test bookmark lands on Overview', async ({ page }) => {
        const baseUrl = await gotoPoWriter(page);
        const agentUrl = baseUrl.split('?')[0];

        // The Test Run tab was deleted; an old bookmark must not render blank.
        await goto(page, `${agentUrl}?tab=test`);
        const overview = page.getByRole('tab').filter({ hasText: 'Overview' }).first();
        await expect(overview).toHaveAttribute('aria-selected', 'true');
    });
});
