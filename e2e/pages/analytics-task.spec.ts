import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Smoke coverage for /analytics/task/:taskId.
// The e2e seed inserts Task ETM-1 ("E2E linked task") in the ETM project.

test.describe('/analytics/task/:taskId', () => {
    test('renders the Task title', async ({ page }) => {
        await goto(page, '/analytics/task/ETM-1');
        await expect(page.getByText('E2E linked task', { exact: true }).first()).toBeVisible();
    });

    test('child-items table section is present in the DOM', async ({ page }) => {
        await goto(page, '/analytics/task/ETM-1');
        await expect(page.getByText('Child items', { exact: true }).first()).toBeVisible();
    });

    test('breadcrumb link back to /analytics is visible', async ({ page }) => {
        await goto(page, '/analytics/task/ETM-1');
        await expect(
            page.getByRole('link', { name: 'Analytics', exact: true }).first(),
        ).toBeVisible();
    });
});
