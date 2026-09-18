import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Marketplace → Workflows tab and a starter template's detail page. The
// templates ship in packages/api/src/marketplace/workflows/*.json.

const STARTERS = ['Delivery', 'Build sub-task', 'Test sub-task', 'AI Readiness'];

test.describe('/agents/marketplace?tab=workflows', () => {
    test('lists the four starter workflows', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await page.getByRole('tab', { name: 'Workflows' }).click();
        await expect(page).toHaveURL(/[?&]tab=workflows/);
        await expect(page.getByRole('heading', { name: 'Workflow Marketplace' })).toBeVisible();
        await expect(page.getByText('4 starter workflows')).toBeVisible();
        for (const name of STARTERS) {
            await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }
    });

    test('Delivery opens its detail page with a canvas preview', async ({ page }) => {
        await goto(page, '/agents/marketplace?tab=workflows');
        await page.getByRole('button', { name: 'Delivery', exact: true }).click();
        await expect(page).toHaveURL(/\/agents\/marketplace\/workflows\/delivery$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Delivery' })).toBeVisible();

        // delivery.json: Start, 4 agents, Owner, 2 Sub-tasks steps, End.
        const canvas = page.locator('.react-flow');
        await expect(canvas.locator('.react-flow__node')).toHaveCount(9);
        await expect(canvas.locator('.react-flow__edge').first()).toBeAttached();
        // Sub-tasks steps are titled with their sub-workflow template's name.
        await expect(canvas.getByText('Build sub-task')).toBeVisible();
        await expect(canvas.getByText('Test sub-task')).toBeVisible();

        const agents = page.getByRole('list', { name: 'Agents' });
        await expect(agents.getByText('PO Writer')).toBeVisible();
        await expect(page.getByRole('link', { name: /Export/ })).toHaveAttribute('href', '/api/workflows/templates/delivery/export');
        await expect(page.getByRole('button', { name: 'Use in a project' })).toBeVisible();

        await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
        await expect(page).toHaveURL(/\/agents\/marketplace\?tab=workflows$/);
    });
});
