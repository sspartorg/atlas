import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, PROJECT_NAME, chainGraph, createTask, createWorkflow } from '../helpers/api.js';

test.describe('/queue', () => {
    test('renders without console errors', async ({ page }) => {
        await goto(page, '/queue');
        await expect(page.getByRole('heading', { name: /queue/i }).first()).toBeVisible();
    });

    test('shows the workflow counter strip and project filter', async ({ page }) => {
        await goto(page, '/queue');
        await expect(page.getByText(/\d+ running · \d+ queued · \d+ waiting on you · \d+ need a workflow/)).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Project' })).toBeVisible();
    });

    test('lists workflow cards, or points at /workflows when there are none', async ({ page }) => {
        await goto(page, '/queue');
        const empty = page.getByRole('link', { name: 'Go to workflows' });
        const card = page.getByRole('progressbar', { name: /running slots/ }).first();
        await expect(empty.or(card)).toBeVisible();
    });

    test.describe('a ready Task without a workflow', () => {
        const name = `E2E queue workflow ${Date.now()}`;
        let workflowId = '';
        let taskId = '';

        test.afterAll(async ({ request }) => {
            if (taskId) await request.delete(`${API}/api/tasks/${taskId}`);
            if (workflowId) await request.delete(`${API}/api/workflows/${workflowId}`);
        });

        test('is picked into a workflow card from "Needs a workflow"', async ({ page, request }) => {
            workflowId = (await createWorkflow(request, name, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }))).id;
            const task = await createTask(request, 'E2E queue task');
            taskId = task.id;
            const ready = await request.patch(`${API}/api/tasks/${taskId}/status`, { data: { status: 'ready' } });
            expect(ready.status(), await ready.text()).toBeLessThan(300);

            await goto(page, '/queue');
            const card = page.getByRole('region', { name, exact: true });
            await expect(card.getByText(`${PROJECT_NAME} · Manual`)).toBeVisible();
            await expect(card.getByText('Nothing running or queued.', { exact: false })).toBeVisible();

            const unassigned = page.getByRole('region', { name: 'Needs a workflow' });
            await expect(unassigned.getByText('E2E queue task')).toBeVisible();
            await unassigned.getByRole('combobox', { name: `Workflow for ${taskId}` }).click();
            await page.getByRole('option', { name }).click();

            await expect(card.getByText('E2E queue task')).toBeVisible();
            await expect(card.getByText('Manual: these wait until you start them.')).toBeVisible();
            await expect(card.getByRole('button', { name: 'Start now' })).toBeVisible();
            await expect(unassigned.getByText('E2E queue task')).toBeHidden();
        });
    });
});
