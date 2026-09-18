import { test, expect, type APIRequestContext } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// SDLC chain (ADR 0015): a Task with two sub-tasks, queued for a Task
// workflow whose Sub-tasks step runs each sub-task through a sub-workflow on
// the Task's branch. AI is disabled in e2e, so every agent step is a
// simulated pass: the run should complete, both child runs complete, and the
// Task + its sub-tasks land in `in_review` (the Owner closes them).
//
// No PR / push: the fixture remote is a bare repo with no GitHub behind it.

const API = 'http://127.0.0.1:6001';
const PROJECT_ID = 'e2e-terminal-project';

interface IRunDetail {
    status: string;
    children: Array<{ item_id: string | null; status: string }>;
}

function graph(middle: Record<string, unknown>) {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            { id: 'step', position: { x: 220, y: 0 }, ...middle },
            { id: 'end', type: 'end', position: { x: 440, y: 0 } },
        ],
        edges: [
            { id: 'e-start', source: 'start', target: 'step', kind: 'pass' },
            { id: 'e-step', source: 'step', target: 'end', kind: 'pass' },
        ],
    };
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
    const res = await request.post(`${API}${path}`, { data });
    expect(res.status(), `POST ${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
}

test.describe('SDLC chain', () => {
    const workflowIds: string[] = [];
    let taskId = '';

    test.afterAll(async ({ request }) => {
        if (taskId) await request.delete(`${API}/api/tasks/${taskId}`);
        for (const id of workflowIds.reverse()) await request.delete(`${API}/api/workflows/${id}`);
    });

    test('Task → Sub-tasks step → sub-workflow runs every sub-task', async ({ page, request }) => {
        const sub = await post<{ id: string }>(request, '/api/workflows', {
            name: 'E2E build sub-task',
            project_id: PROJECT_ID,
            status: 'active',
            input_kind: 'sub_task',
            trigger: 'manual',
            use_worktree: true,
            push_code: false,
            raises_pr: false,
            graph: graph({ type: 'agent', agent_id: 'agent-po-writer' }),
        });
        workflowIds.push(sub.id);
        const wf = await post<{ id: string }>(request, '/api/workflows', {
            name: 'E2E deliver task',
            project_id: PROJECT_ID,
            status: 'active',
            input_kind: 'item',
            trigger: 'manual',
            use_worktree: true,
            push_code: false,
            raises_pr: false,
            graph: graph({ type: 'subtasks', sub_workflow_id: sub.id }),
        });
        workflowIds.push(wf.id);

        const task = await post<{ id: string }>(request, '/api/tasks', {
            project_id: PROJECT_ID,
            title: 'SDLC chain task',
            description: 'Created by sdlc-full-chain.spec.ts',
        });
        taskId = task.id;
        const subTaskIds: string[] = [];
        for (const title of ['SDLC chain sub-task A', 'SDLC chain sub-task B']) {
            subTaskIds.push((await post<{ id: string }>(request, `/api/tasks/${taskId}/sub-tasks`, { title })).id);
        }

        const queued = await request.put(`${API}/api/items/${taskId}/workflow`, {
            data: { workflow_id: wf.id },
        });
        expect(queued.status()).toBeLessThan(300);
        const { run_id: runId } = await post<{ run_id: string }>(request, `/api/workflows/${wf.id}/runs`, {
            item_id: taskId,
        });

        const getRun = async () =>
            (await (await request.get(`${API}/api/workflow-runs/${runId}`)).json()) as IRunDetail;
        await expect
            .poll(async () => (await getRun()).status, { timeout: 60_000, intervals: [1_000] })
            .toBe('completed');
        const done = await getRun();
        expect(done.children.map((c) => [c.item_id, c.status])).toEqual(
            subTaskIds.map((id) => [id, 'completed']),
        );

        const taskRes = await request.get(`${API}/api/tasks/${taskId}`);
        expect(((await taskRes.json()) as { status: string }).status).toBe('in_review');
        for (const id of subTaskIds) {
            const res = await request.get(`${API}/api/sub-tasks/${id}`);
            expect(((await res.json()) as { status: string }).status).toBe('in_review');
        }

        await goto(page, `/workflows/${wf.id}/runs/${runId}`);
        await expect(page.getByText('Sub-tasks · 2 of 2 done').first()).toBeVisible();

        await goto(page, `/tasks/${taskId}`);
        await expect(page.getByText('SDLC chain sub-task A').first()).toBeVisible();
        await expect(page.getByText('SDLC chain sub-task B').first()).toBeVisible();
    });
});
