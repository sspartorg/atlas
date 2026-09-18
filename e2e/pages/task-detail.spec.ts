import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// The e2e seed creates Task ETM-1 ("E2E linked task", in_progress) in the
// E2E Terminal project, with one sub-task ETM-2 ("E2E seeded sub-task").

const API = 'http://127.0.0.1:6001';

test.describe('/tasks/:id', () => {
    test('happy-path: renders Task id and Conversation section', async ({ page }) => {
        await goto(page, '/tasks/ETM-1');
        await expect(page.getByText('ETM-1').first()).toBeVisible();
        await expect(page.getByText('Conversation').first()).toBeVisible();
    });

    test('status chip: "In Progress" is visible in the details rail', async ({ page }) => {
        await goto(page, '/tasks/ETM-1');
        await expect(page.getByText('In Progress').first()).toBeVisible();
    });

    test('comment composer is present and empty on load', async ({ page }) => {
        await goto(page, '/tasks/ETM-1');
        const composer = page.getByRole('textbox').first();
        await expect(composer).toBeVisible();
        await expect(composer).toHaveValue('');
    });

    test('Sub-tasks table lists the seeded sub-task and opens it', async ({ page }) => {
        await goto(page, '/tasks/ETM-1');
        await page.getByText('E2E seeded sub-task').first().click();
        await expect(page).toHaveURL(/\/sub-tasks\/ETM-2$/);
    });

    test('"Add sub-task" creates a sub-task under the Task', async ({ page, request }) => {
        const title = `E2E added sub-task ${Date.now()}`;
        await goto(page, '/tasks/ETM-1');
        await page.getByRole('button', { name: 'Add sub-task', exact: true }).click();

        const form = page.getByRole('form', { name: 'Add sub-task' });
        await expect(form).toBeVisible();
        const submit = form.getByRole('button', { name: 'Add sub-task', exact: true });
        await expect(submit).toBeDisabled();
        await form.getByLabel(/^Title/).fill(title);
        await submit.click();

        await expect(form).toBeHidden();
        await expect(page.getByText(title).first()).toBeVisible();

        const res = await request.get(`${API}/api/tasks/ETM-1/sub-tasks`);
        const created = ((await res.json()) as Array<{ id: string; title: string }>).find(
            (s) => s.title === title,
        );
        expect(created, 'sub-task persisted under ETM-1').toBeTruthy();
        if (created) await request.delete(`${API}/api/sub-tasks/${created.id}`);
    });
});
