import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IWorkflowRunSummary } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeRunDetail, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { ItemWorkflowPanel } from './ItemWorkflowPanel.js';

const BASE = 'http://localhost:3000/api';

function summary(overrides: Partial<IWorkflowRunSummary> = {}): IWorkflowRunSummary {
    const { steps: _steps, workflow_name: _name, ...run } = makeRunDetail();
    return { ...run, ...overrides };
}

// A Task workflow whose Sub-tasks step builds each sub-task.
const delivery = makeWorkflow({
    id: 'wf-delivery',
    name: 'Delivery',
    graph: {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            {
                id: 'build',
                type: 'subtasks',
                sub_workflow_id: 'wf-build',
                position: { x: 0, y: 130 },
            },
            { id: 'end', type: 'end', position: { x: 0, y: 260 } },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'build', kind: 'pass' },
            { id: 'e2', source: 'build', target: 'end', kind: 'pass' },
        ],
    },
});

function mount(opts: {
    workflowId: string | null;
    runs: IWorkflowRunSummary[];
    subTaskStatuses?: string[];
}) {
    server.use(
        http.get(`${BASE}/tasks/ATL-7/full`, () =>
            HttpResponse.json({
                task: { id: 'ATL-7', workflow_id: opts.workflowId },
                sub_tasks: (opts.subTaskStatuses ?? []).map((status, i) => ({
                    id: `ATL-${10 + i}`,
                    status,
                })),
            })
        ),
        http.get(`${BASE}/workflows`, () =>
            HttpResponse.json([
                makeWorkflow(),
                makeWorkflow({ id: 'wf-scan', name: 'Stack scan', input_kind: 'none' }),
                delivery,
            ])
        ),
        http.get(`${BASE}/items/ATL-7/workflow-runs`, () => HttpResponse.json(opts.runs))
    );
    return renderWithProviders(<ItemWorkflowPanel itemId="ATL-7" projectId="p1" />);
}

describe('ItemWorkflowPanel', () => {
    it('assigns the task to one of the project’s item workflows', async () => {
        const user = userEvent.setup();
        let sent: unknown = null;
        mount({ workflowId: null, runs: [] });
        server.use(
            http.put(`${BASE}/items/ATL-7/workflow`, async ({ request }) => {
                sent = await request.json();
                return new HttpResponse(null, { status: 204 });
            })
        );

        await user.click(await screen.findByRole('combobox', { name: 'Workflow' }));
        expect(screen.queryByRole('option', { name: 'Stack scan' })).not.toBeInTheDocument();
        await user.click(await screen.findByRole('option', { name: 'Development' }));
        await waitFor(() => expect(sent).toEqual({ workflow_id: 'wf-1' }));
        expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();
    });

    it('links the latest run and hides Start now while it is live', async () => {
        mount({ workflowId: 'wf-1', runs: [summary({ status: 'waiting_for_owner' })] });
        const chip = await screen.findByText('Waiting for you');
        expect(chip.closest('a')).toHaveAttribute('href', '/workflows/wf-1/runs/wfr-1');
        expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();
    });

    it('starts the workflow when no run is live', async () => {
        const user = userEvent.setup();
        let sent: unknown = null;
        mount({ workflowId: 'wf-1', runs: [summary({ status: 'completed' })] });
        server.use(
            http.post(`${BASE}/workflows/wf-1/runs`, async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json({ run_id: 'wfr-2' }, { status: 202 });
            })
        );
        await user.click(await screen.findByRole('button', { name: 'Start now' }));
        await waitFor(() => expect(sent).toEqual({ item_id: 'ATL-7' }));
    });

    it('continues a reviewed Task with its open sub-tasks when its workflow has a Sub-tasks step', async () => {
        const user = userEvent.setup();
        let sent: unknown = null;
        mount({
            workflowId: 'wf-delivery',
            runs: [summary({ status: 'completed', workflow_id: 'wf-delivery' })],
            subTaskStatuses: ['in_review', 'ready'],
        });
        server.use(
            http.post(`${BASE}/workflows/wf-delivery/runs`, async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json({ run_id: 'wfr-3' }, { status: 202 });
            })
        );
        await user.click(await screen.findByRole('button', { name: 'Continue · 1 open' }));
        await waitFor(() => expect(sent).toEqual({ item_id: 'ATL-7', from_subtasks: true }));
    });

    it('offers no Continue when every sub-task is in review or done', async () => {
        mount({
            workflowId: 'wf-delivery',
            runs: [summary({ status: 'completed', workflow_id: 'wf-delivery' })],
            subTaskStatuses: ['in_review', 'done'],
        });
        expect(await screen.findByRole('button', { name: 'Start now' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
    });
});
