import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/projects', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/projects');
        await expect(page.getByRole('heading', { name: /Projects/i }).first()).toBeVisible();
    });

    test('sidenav nav works from dashboard to projects', async ({ page }) => {
        // W5 fix: allow ERR_CONNECTION_CLOSED — a transient resource-load
        // failure that can appear when the dev server is under load from a
        // prior heavy test (e.g. terminal lifecycle). The sidenav itself
        // always loads from the shell, not the page-level chunk.
        await goto(page, '/', { allow: [/ERR_CONNECTION_CLOSED/i] });
        // Sidenav uses <Box onClick>, not <a role="link">; locate by data-testid.
        await page.getByTestId('nav-item-projects').click();
        await expect(page).toHaveURL(/\/projects/);
    });
});
