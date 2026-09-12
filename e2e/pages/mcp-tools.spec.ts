import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// W-coverage — MCP Tools page smoke tests. The tool catalog is synced
// by syncToolCatalog() at API boot (via runSeed), so the page always
// shows at least the Items / Agents / Projects groups.

test.describe('/agents/mcp-tools', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/agents/mcp-tools');
        await expect(
            page.getByRole('heading', { name: 'MCP Tools', exact: true })
        ).toBeVisible();
    });

    test('tool catalogue lists known tools from the Items group', async ({ page }) => {
        await goto(page, '/agents/mcp-tools');
        // The ITEMS group's tools were consolidated to a snake_case CRUD set
        // (`search_item` / `create_item` / `get_item` / `update_item` /
        // `delete_item`); the old `searchItems` + `createEpic` names this
        // asserted no longer exist in the catalog.
        await expect(page.getByText('search_item').first()).toBeVisible();
        await expect(page.getByText('create_item').first()).toBeVisible();
    });

    test('summary badge shows a non-zero tool count', async ({ page }) => {
        await goto(page, '/agents/mcp-tools');
        // The McpTools component renders a badge like "42 tools · 6 categories"
        // once loading completes. Match the numeric prefix with a regex so the
        // exact count doesn't need to be hard-coded.
        await expect(
            page.getByText(/^\d+ tools · \d+ categories$/).first()
        ).toBeVisible();
    });
});
