import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// The e2e seed creates Task ETM-1 ("E2E linked task") with one sub-task.

test.describe('/tasks', () => {
    test('renders without console errors and lists the seeded Task', async ({ page }) => {
        await goto(page, '/tasks');
        await expect(page.getByRole('heading', { name: /Tasks/i }).first()).toBeVisible();
        await expect(page.getByText('E2E linked task').first()).toBeVisible();
    });

    test('"New Task" navigates to /tasks/new', async ({ page }) => {
        await goto(page, '/tasks');
        await page.getByRole('button', { name: /New Task/i }).first().click();
        await expect(page).toHaveURL(/\/tasks\/new$/);
    });

    test('clicking a Task row opens its detail page', async ({ page }) => {
        await goto(page, '/tasks');
        await page.getByText('E2E linked task').first().click();
        await expect(page).toHaveURL(/\/tasks\/ETM-1$/);
    });
});
