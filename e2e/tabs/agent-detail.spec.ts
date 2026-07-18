import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Tab key → URL param value (from TAB_KEYS in AgentDetail.tsx)
// "test" is the URL key for the "Test Run" tab.
const TABS = [
    { label: 'Overview', key: 'overview' },
    { label: 'Prompt',   key: 'prompt'   },
    { label: 'Handoffs', key: 'handoffs' },
    { label: 'Test Run', key: 'test'     },
    { label: 'Runs',     key: 'runs'     },
    { label: 'Memory',   key: 'memory'   },
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
    test('all 6 tabs are reachable, selected', async ({ page }) => {
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

    test('Test Run tab does not auto-fire a run on mount', async ({ page }) => {
        const baseUrl = await gotoPoWriter(page);
        const agentUrl = baseUrl.split('?')[0];

        await goto(page, `${agentUrl}?tab=test`);

        // "Run test" button must be present and enabled (idle state).
        const runBtn = page.getByRole('button', { name: /run test/i });
        await expect(runBtn).toBeVisible();
        await expect(runBtn).toBeEnabled();

        // No lines should appear in the terminal panel — it starts empty.
        // The placeholder text is shown when there is no output yet.
        await expect(
            page.getByText(/press "run test" to invoke/i),
        ).toBeVisible();
    });
});
