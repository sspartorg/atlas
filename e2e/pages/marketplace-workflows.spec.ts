import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Marketplace → Workflows tab and a starter template's detail page. The
// templates ship in packages/api/src/marketplace/workflows/*.json.
//
// Counts are READ from those files rather than restated here. The previous
// hardcoded "4 starter workflows" and 9-node Delivery went stale the moment the
// catalog grew a Docs sub-workflow and four gate steps, and the failure read as
// a broken page rather than an out-of-date number.

const TEMPLATES_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'packages',
    'api',
    'src',
    'marketplace',
    'workflows'
);

interface Template {
    id: string;
    name: string;
    graph: { nodes: unknown[] };
}

const TEMPLATES: Template[] = readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf8')) as Template);

const DELIVERY = TEMPLATES.find((t) => t.id === 'delivery');
if (!DELIVERY) throw new Error('delivery.json is missing from the workflow templates');

test.describe('/agents/marketplace?tab=workflows', () => {
    test('lists every starter workflow', async ({ page }) => {
        await goto(page, '/agents/marketplace');
        await page.getByRole('tab', { name: 'Workflows' }).click();
        await expect(page).toHaveURL(/[?&]tab=workflows/);
        await expect(page.getByRole('heading', { name: 'Workflow Marketplace' })).toBeVisible();
        await expect(page.getByText(`${TEMPLATES.length} starter workflows`)).toBeVisible();
        for (const t of TEMPLATES) {
            await expect(page.getByRole('button', { name: t.name, exact: true })).toBeVisible();
        }
    });

    test('Delivery opens its detail page with a canvas preview', async ({ page }) => {
        await goto(page, '/agents/marketplace?tab=workflows');
        await page.getByRole('button', { name: 'Delivery', exact: true }).click();
        await expect(page).toHaveURL(/\/agents\/marketplace\/workflows\/delivery$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Delivery' })).toBeVisible();

        const canvas = page.locator('.react-flow');
        await expect(canvas.locator('.react-flow__node')).toHaveCount(DELIVERY.graph.nodes.length);
        await expect(canvas.locator('.react-flow__edge').first()).toBeAttached();
        // Sub-tasks steps are titled with their sub-workflow template's name.
        await expect(canvas.getByText('Build sub-task')).toBeVisible();
        await expect(canvas.getByText('Test sub-task')).toBeVisible();
        await expect(canvas.getByText('Docs sub-task')).toBeVisible();
        // A gate step names its script and says plainly that nobody runs there.
        // Scoped by node id: the bare text "Coverage" also matches the
        // `agent-coverage-fixer` node beside it, which the preview renders by
        // id because no agent is installed to resolve a name from.
        const coverageGate = canvas.getByTestId('wf-node-gate-coverage');
        await expect(coverageGate.getByText('Coverage')).toBeVisible();
        await expect(coverageGate.getByText('No agent runs here')).toBeVisible();

        const agents = page.getByRole('list', { name: 'Agents' });
        await expect(agents.getByText('PO Writer')).toBeVisible();
        await expect(page.getByRole('link', { name: /Export/ })).toHaveAttribute(
            'href',
            '/api/workflows/templates/delivery/export'
        );
        await expect(page.getByRole('button', { name: 'Use in a project' })).toBeVisible();

        await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
        await expect(page).toHaveURL(/\/agents\/marketplace\?tab=workflows$/);
    });
});
