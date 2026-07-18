import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/search', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/search');
        // Page heading and search input must both be visible on load
        await expect(page.getByRole('heading', { name: /Search/i }).first()).toBeVisible();
        await expect(page.getByLabel(/Search by title, description, or ID/i)).toBeVisible();
    });

    test('typing syncs ?q= to the URL', async ({ page }) => {
        await goto(page, '/search');
        const input = page.getByLabel(/Search by title, description, or ID/i);
        await input.fill('hello');
        // URL sync is debounced 250 ms — wait for it
        await expect(page).toHaveURL(/[?&]q=hello/, { timeout: 2000 });
        // Empty-state or results section must be present — either is valid
        // with a seed that may return no hits
        await expect(
            page.getByText(/No Items Match|no items match/i).or(page.locator('[data-testid="search-results"]')).first()
        ).toBeVisible({ timeout: 3000 });
    });

    test('Add Filter opens the filter menu', async ({ page }) => {
        await goto(page, '/search');
        // "Add Filter" is the dashed pill button in SearchFilterBuilder
        const addFilter = page.getByRole('button', { name: /Add Filter/i });
        await expect(addFilter).toBeVisible();
        await addFilter.click();
        // The dropdown menu should show filter options
        await expect(page.getByRole('menuitem', { name: /Type/i }).first()).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /Status/i }).first()).toBeVisible();
    });
});
