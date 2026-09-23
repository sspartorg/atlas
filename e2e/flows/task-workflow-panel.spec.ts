import { test, expect, type APIRequestContext } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost, chainGraph, createTask, createWorkflow } from '../helpers/api.js';

// Task detail → rail's ItemWorkflowPanel (ADR 0015). AI is off in e2e, so
// agent steps are simulated passes and runs finish on their own.

interface IRunSummary {
    id: string;
    status: string;
}
interface IRunDetail extends IRunSummary {
    steps: Array<{ agent_id: string }>;
    children: Array<{ item_id: string | null; status: string }>;
}

const getRun = (request: APIRequestContext, id: string) => apiGet<IRunDetail>(request, `/api/workflow-runs/${id}`);

async function waitForRun(request: APIRequestContext, id: string, status = 'completed') {
    await expect
        .poll(async () => (await getRun(request, id)).status, { timeout: 60_000, intervals: [1_000] })
        .toBe(status);
    return getRun(request, id);
}

test.describe('Task workflow panel', () => {
    const workflowIds: string[] = [];
    const taskIds: string[] = [];

    test.afterAll(async ({ request }) => {
        for (const id of taskIds) await request.delete(`${API}/api/tasks/${id}`);
        for (const id of workflowIds.reverse()) await request.delete(`${API}/api/workflows/${id}`);
    });

    test('picking a workflow for a Draft Task moves it to Ready', async ({ page, request }) => {
        const name = `E2E queue-on-pick ${Date.now()}`;
        workflowIds.push((await createWorkflow(request, name, chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }))).id);
        const task = await createTask(request, 'E2E draft task');
        taskIds.push(task.id);
        expect(task.status).toBe('draft');

        await goto(page, `/tasks/${task.id}`);
        const status = page.getByLabel('Draft', { exact: true }).first();
        await expect(status).toBeVisible();
        await page.getByRole('combobox', { name: 'Workflow' }).click();
        await page.getByRole('option', { name }).click();

        await expect(page.getByRole('combobox', { name: 'Workflow' })).toHaveText(name);
        await expect(page.getByLabel('Ready', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
        const saved = await apiGet<{ status: string; workflow_id: string | null }>(request, `/api/tasks/${task.id}`);
        expect([saved.status, saved.workflow_id]).toEqual(['ready', workflowIds.at(-1)]);
    });

    test('Continue runs a finished Task\'s open sub-tasks from its Sub-tasks step', async ({ page, request }) => {
        const stamp = Date.now();
        const sub = await createWorkflow(
            request,
            `E2E continue sub ${stamp}`,
            chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }),
            'sub_task',
        );
        workflowIds.push(sub.id);
        const wf = await createWorkflow(
            request,
            `E2E continue ${stamp}`,
            chainGraph({ type: 'agent', agent_id: 'agent-po-writer' }, { type: 'subtasks', sub_workflow_id: sub.id }),
        );
        workflowIds.push(wf.id);
        const task = await createTask(request, 'E2E continue task');
        taskIds.push(task.id);
        const first = await apiPost<{ id: string }>(request, `/api/tasks/${task.id}/sub-tasks`, { title: 'E2E first sub-task' });

        const queued = await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
        expect(queued.status(), await queued.text()).toBeLessThan(300);
        const { run_id } = await apiPost<{ run_id: string }>(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });
        const firstRun = await waitForRun(request, run_id);
        expect(firstRun.steps.map((s) => s.agent_id)).toEqual(['agent-po-writer']);
        expect(firstRun.children.map((c) => c.item_id)).toEqual([first.id]);

        // Nothing open after the run: no Continue. The Task is now in review, so
        // the start affordance reads "Restart" — running it again re-enters the
        // graph at step 1 and resets the worktree, which is not a resume.
        await goto(page, `/tasks/${task.id}`);
        await expect(page.getByRole('button', { name: 'Restart' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start now' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Continue/ })).toHaveCount(0);

        // A fix sub-task added after review is open → Continue · 1 open.
        const fix = await apiPost<{ id: string }>(request, `/api/tasks/${task.id}/sub-tasks`, { title: 'E2E fix sub-task' });
        // reload, not goto: a same-URL goto aborts the first visit's in-flight fetches.
        await page.reload();
        const cont = page.getByRole('button', { name: 'Continue · 1 open' });
        await expect(cont).toBeVisible();
        await cont.click();

        await expect
            .poll(async () => (await apiGet<IRunSummary[]>(request, `/api/items/${task.id}/workflow-runs`)).length, {
                timeout: 15_000,
            })
            .toBe(2);
        const [latest] = await apiGet<IRunSummary[]>(request, `/api/items/${task.id}/workflow-runs`);
        expect(latest?.id).not.toBe(run_id);
        const second = await waitForRun(request, latest?.id ?? '');
        // Started at the Sub-tasks step: the Task-level agent step didn't rerun,
        // and only the open sub-task went through the sub-workflow.
        expect(second.steps).toEqual([]);
        expect(second.children.map((c) => [c.item_id, c.status])).toEqual([[fix.id, 'completed']]);

        await goto(page, `/workflows/${wf.id}/runs/${second.id}`);
        await expect(page.getByText('Sub-tasks · 1 of 1 done').first()).toBeVisible();

        await goto(page, `/tasks/${task.id}`);
        // Still in review after the continue run, so still "Restart".
        await expect(page.getByRole('button', { name: 'Restart' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Continue/ })).toHaveCount(0);
    });
});
