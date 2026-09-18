import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// The e2e seed creates sub-task ETM-2 ("E2E seeded sub-task", draft) under
// Task ETM-1 ("E2E linked task").

test.describe('/sub-tasks/:id', () => {
    test('renders without console errors; id and title visible', async ({ page }) => {
        await goto(page, '/sub-tasks/ETM-2');
        await expect(page.getByText('ETM-2').first()).toBeVisible();
        await expect(page.getByText('E2E seeded sub-task').first()).toBeVisible();
    });

    test('status chip and empty comment composer are visible', async ({ page }) => {
        await goto(page, '/sub-tasks/ETM-2');
        await expect(page.getByText('Draft').first()).toBeVisible();
        const composer = page.getByRole('textbox').first();
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue('');
    });

    test('breadcrumb links back to the parent Task', async ({ page }) => {
        await goto(page, '/sub-tasks/ETM-2');
        // Breadcrumb crumbs are clickable text, not anchors.
        await page.getByText('ETM-1', { exact: true }).first().click();
        await expect(page).toHaveURL(/\/tasks\/ETM-1$/);
    });
});
