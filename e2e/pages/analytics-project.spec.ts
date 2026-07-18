import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Seed project: id=e2e-terminal-project, name="E2E Terminal".
// Hero renders project name as a plain <Typography> (no variant — i.e.
// <p>, not a heading element), so assertions use getByText, not getByRole.

test.describe('/analytics/project/:projectId', () => {
    test('renders project hero with name and breadcrumb', async ({ page }) => {
        await goto(page, '/analytics/project/e2e-terminal-project');
        // Project name surfaces in both the breadcrumb and the Hero title.
        // Strict-mode multi-match is fine here as both occurrences are valid.
        await expect(page.getByText('E2E Terminal').first()).toBeVisible();
        // Analytics breadcrumb link
        await expect(page.getByRole('link', { name: 'Analytics' })).toBeVisible();
    });

    test('KPI strip metric labels are present in the DOM', async ({ page }) => {
        await goto(page, '/analytics/project/e2e-terminal-project');
        await expect(page.getByText('Total spend').first()).toBeVisible();
        await expect(page.getByText('Agentic runs').first()).toBeVisible();
        await expect(page.getByText('Epics').first()).toBeVisible();
    });

    test('top-epics card renders its header', async ({ page }) => {
        await goto(page, '/analytics/project/e2e-terminal-project');
        // ChartTitle for the top-epics ladder
        await expect(page.getByText('Top epics by total cost').first()).toBeVisible();
    });
});
