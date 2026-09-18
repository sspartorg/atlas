import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// /tasks/new smoke spec — asserts the new-task form renders its controls and
// that an empty submit creates nothing. The e2e seed inserts the "E2E
// Terminal" project (id: e2e-terminal-project) for the Project selector.

test.describe('/tasks/new', () => {
    test('renders without console errors and shows the form heading', async ({ page }) => {
        await goto(page, '/tasks/new');
        await expect(page.getByText(/Draft a new task/i).first()).toBeVisible();
    });

    test('form has Title, Description, Project, Priority fields', async ({ page }) => {
        await goto(page, '/tasks/new');
        await expect(page.getByLabel(/^Title/i)).toBeVisible();
        await expect(page.getByLabel(/^Description/i)).toBeVisible();
        await expect(page.getByLabel(/^Project/i)).toBeVisible();
        await expect(page.getByLabel(/^Priority/i)).toBeVisible();
    });

    // The form validates on submit (inline "X is required." under each
    // field) rather than disabling Submit until valid, so assert the
    // property that matters: an empty submit creates nothing and says why.
    test('submitting an empty form creates nothing and shows why', async ({ page }) => {
        await goto(page, '/tasks/new');
        const before = await page.request.get('/api/tasks');
        const countBefore = ((await before.json()) as unknown[]).length;

        await page.getByRole('button', { name: /Submit/i }).first().click();

        await expect(page.getByText(/Title is required/i).first()).toBeVisible();
        await expect(page).toHaveURL(/\/tasks\/new/);
        const after = await page.request.get('/api/tasks');
        expect(((await after.json()) as unknown[]).length).toBe(countBefore);
    });

    test('Cancel navigates away from /tasks/new', async ({ page }) => {
        await goto(page, '/tasks/new');
        // Title has `autoFocus` and validates on blur. Clicking Cancel blurs
        // Title, which inserts a "Title is required." line ABOVE the button
        // row and shifts Cancel out from under the cursor mid-click. Blur
        // first so the footer is settled before the real click.
        const title = page.getByLabel('Title');
        await expect(title).toBeVisible();
        await title.blur();
        await expect(page.getByText(/Title is required/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
        await expect(page).toHaveURL(/\/tasks(?!\/new)/);
    });

    test('Save as draft button is present', async ({ page }) => {
        await goto(page, '/tasks/new');
        await expect(page.getByRole('button', { name: /Save as draft/i }).first()).toBeVisible();
    });
});
