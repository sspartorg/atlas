import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Smoke coverage for /analytics/epic/:epicId.
// The e2e seed inserts epic ETM-1 ("E2E linked epic") in the ETM project.

test.describe('/analytics/epic/:epicId', () => {
    test('renders page heading and epic title', async ({ page }) => {
        await goto(page, '/analytics/epic/ETM-1');
        // Hero title — exact match guards against partial collisions
        await expect(
            page.getByText('E2E linked epic', { exact: true }).first(),
        ).toBeVisible();
    });

    test('child-items table section is present in the DOM', async ({ page }) => {
        await goto(page, '/analytics/epic/ETM-1');
        // ChartTitle eyebrow "Child items" is always rendered regardless
        // of whether the epic has any descendants.
        await expect(
            page.getByText('Child items', { exact: true }).first(),
        ).toBeVisible();
    });

    test('breadcrumb link back to /analytics is visible', async ({ page }) => {
        await goto(page, '/analytics/epic/ETM-1');
        // Hero breadcrumb renders a RouterLink with the text "Analytics"
        await expect(
            page.getByRole('link', { name: 'Analytics', exact: true }).first(),
        ).toBeVisible();
    });
});
