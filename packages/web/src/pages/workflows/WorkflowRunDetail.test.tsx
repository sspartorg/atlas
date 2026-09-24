import { beforeAll, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { IWorkflowRunDetail } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { makeRunDetail, makeRunStep, stubReactFlowDom } from '../../test-utils/workflowFixtures.js';
import { WorkflowRunDetail } from './WorkflowRunDetail.js';

const BASE = 'http://localhost:3000/api';

beforeAll(stubReactFlowDom);

function mount(run: IWorkflowRunDetail, gates: unknown[] = []) {
    server.use(
        http.get(`${BASE}/workflow-runs/${run.id}`, () => HttpResponse.json(run)),
        http.get(`${BASE}/workflow-runs/${run.id}/gate-results`, () => HttpResponse.json(gates)),
        http.get(`${BASE}/workflows`, () => HttpResponse.json([])),
        http.get(`${BASE}/agents`, () =>
            HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'Coder' })])
        ),
        http.get(`${BASE}/issues/tree`, () =>
            HttpResponse.json({
                projects: [],
                agents: [],
                tree: [],
                tasks: [],
            })
        )
    );
    return renderWithProviders(
        <Routes>
            <Route path="/workflows/:id/runs/:runId" element={<WorkflowRunDetail />} />
            <Route path="/agents/:id/runs/:runId" element={<div>agent run page</div>} />
        </Routes>,
        { initialEntries: [`/workflows/${run.workflow_id}/runs/${run.id}`] }
    );
}

describe('WorkflowRunDetail', () => {
    it('highlights nodes by step status and shows the running node', async () => {
        mount(
            makeRunDetail({
                status: 'running',
                current_node_id: 'review',
                steps: [
                    makeRunStep({ id: 'r1', node_id: 'coder', status: 'completed' }),
                    makeRunStep({
                        id: 'r2',
                        node_id: 'review',
                        status: 'completed',
                        agent_id: 'agent-reviewer',
                        agent_name: 'Reviewer',
                    }),
                    makeRunStep({ id: 'r3', node_id: 'coder', status: 'completed' }),
                    makeRunStep({
                        id: 'r4',
                        node_id: 'review',
                        status: 'in_progress',
                        agent_id: 'agent-reviewer',
                        agent_name: 'Reviewer',
                    }),
                ],
            })
        );
        await waitFor(() =>
            expect(screen.getByTestId('wf-node-coder')).toHaveAttribute('data-run-state', 'done')
        );
        expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-run-state', 'current');
        expect(screen.getByTestId('wf-node-start')).toHaveAttribute('data-run-state', 'done');
        expect(screen.getByTestId('wf-node-end')).toHaveAttribute('data-run-state', '');
        expect(screen.getAllByTestId('node-visits').map((b) => b.textContent)).toEqual([
            '×2',
            '×2',
        ]);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    });

    it('explains a parked run, offers Resume and resumes it', async () => {
        const user = userEvent.setup();
        const run = makeRunDetail({
            status: 'waiting_for_owner',
            current_node_id: null,
            parked_node_id: 'review',
            steps: [
                makeRunStep({
                    id: 'r1',
                    node_id: 'coder',
                    status: 'error',
                    outcome_kind: null,
                    outcome_summary: null,
                    outcome_reason: 'CLI crashed',
                }),
            ],
        });
        let resumed = false;
        mount(run);
        server.use(
            http.post(`${BASE}/workflow-runs/${run.id}/resume`, () => {
                resumed = true;
                return HttpResponse.json({
                    ...run,
                    status: 'running',
                    parked_node_id: null,
                    current_node_id: 'review',
                });
            })
        );

        expect(await screen.findByText(/Reply on the item to continue/)).toBeInTheDocument();
        expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-run-state', 'parked');
        expect(screen.getByTestId('wf-node-coder')).toHaveAttribute('data-run-state', 'failed');
        expect(screen.getByText('CLI crashed')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(resumed).toBe(true));
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
        );
    });

    it('opens the agent run page when a step is clicked', async () => {
        const user = userEvent.setup();
        mount(makeRunDetail());
        await user.click(await screen.findByTestId('wf-step-run-a'));
        expect(await screen.findByText('agent run page')).toBeInTheDocument();
    });

    it('lists the sub-task runs of a Task run and opens one', async () => {
        const user = userEvent.setup();
        const child = {
            ...makeRunDetail({
                id: 'wfr-child',
                workflow_id: 'wf-build',
                item_id: 'ATL-8',
                status: 'completed',
            }),
            item_title: 'Fix typo',
            parent_node_id: 'build',
        };
        mount(makeRunDetail({ children: [child] }));
        const row = await screen.findByTestId('wf-child-wfr-child');
        expect(row).toHaveTextContent('ATL-8');
        expect(row).toHaveTextContent('Fix typo');
        expect(screen.getByText('Sub-tasks · 1 of 1 done')).toBeInTheDocument();
        server.use(
            http.get(`${BASE}/workflow-runs/wfr-child`, () =>
                HttpResponse.json({ ...child, parent_workflow_run_id: 'wfr-1', children: [] })
            )
        );
        await user.click(row);
        expect(await screen.findByRole('link', { name: 'part of the Task run' })).toHaveAttribute(
            'href',
            '/workflows/wf-build/runs/wfr-1'
        );
    });

    // Gate nodes spawn no agent, so they have no `agent_runs` row and never
    // appeared on this page. The Owner therefore could not see why a gate
    // passed — or that it had not run at all.
    describe('gate verdicts', () => {
        it('lists each gate with its script id and verdict', async () => {
            mount(makeRunDetail({ id: 'r1', workflow_id: 'w1' }), [
                { id: '1', node_id: 'gate-hygiene', repo_id: null, repo_name: null, script_id: 'gate-hygiene', verdict: 'pass', exit_code: null, output_tail: null, created_at: '2026-09-24T00:00:01' },
                { id: '2', node_id: 'gate-perf', repo_id: null, repo_name: null, script_id: 'gate-perf', verdict: 'pass', exit_code: null, output_tail: 'gate-perf: within budget', created_at: '2026-09-24T00:00:02' },
            ]);
            expect(await screen.findByText('gate-hygiene')).toBeInTheDocument();
            expect(screen.getByText('gate-perf')).toBeInTheDocument();
            expect(screen.getAllByText('passed').length).toBeGreaterThan(0);
        });

        // The reason this section exists. `gate-visual` reported a pass on the
        // one golden-set fixture built to exercise it, because a skip and a
        // pass were the same verdict. They must never read alike again.
        it('shows a skip as skipped, not as passed, and gives the reason', async () => {
            mount(makeRunDetail({ id: 'r1', workflow_id: 'w1' }), [
                { id: '3', node_id: 'gate-visual', repo_id: null, repo_name: null, script_id: 'gate-visual', verdict: 'skipped', exit_code: null, output_tail: 'gate-visual: skipped - no UI files changed and no markup added', created_at: '2026-09-24T00:00:03' },
            ]);
            expect(await screen.findByText('skipped')).toBeInTheDocument();
            expect(screen.queryByText('passed')).not.toBeInTheDocument();
            expect(
                screen.getByText(/skipped - no UI files changed and no markup added/)
            ).toBeInTheDocument();
        });

        it('counts the skips in the section header', async () => {
            mount(makeRunDetail({ id: 'r1', workflow_id: 'w1' }), [
                { id: '4', node_id: 'gate-hygiene', repo_id: null, repo_name: null, script_id: 'gate-hygiene', verdict: 'pass', exit_code: null, output_tail: null, created_at: '2026-09-24T00:00:04' },
                { id: '5', node_id: 'gate-coverage', repo_id: null, repo_name: null, script_id: 'gate-coverage', verdict: 'skipped', exit_code: null, output_tail: 'gate-coverage: skipped - no coverage script and no test script declared', created_at: '2026-09-24T00:00:05' },
            ]);
            expect(await screen.findByText(/Gates · 2 · 1 skipped/)).toBeInTheDocument();
        });

        it('renders nothing when the run ran no gates', async () => {
            mount(makeRunDetail({ id: 'r1', workflow_id: 'w1' }), []);
            await screen.findByText(/Steps/);
            expect(screen.queryByText(/Gates ·/)).not.toBeInTheDocument();
        });
    });
});
