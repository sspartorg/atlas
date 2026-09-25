import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { WorkflowEvalsTab } from './WorkflowEvalsTab.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

const fixture = (over: Record<string, unknown> = {}) => ({
    id: 'fx-1',
    agent_id: null,
    workflow_id: 'wf-1',
    suite: 'golden',
    project_id: 'p1',
    repo_id: 'r1',
    name: 'ambiguous must escalate',
    item_template: { issue_type: 'task', title: 'Make the thing better' },
    expectations: { requires_pr: false },
    created_at: '2026-09-25T00:00:00Z',
    updated_at: '2026-09-25T00:00:00Z',
    ...over,
});

function mount({ fixtures = [], parked = [], batches = [], runFails = false, onRun }: {
    fixtures?: unknown[];
    parked?: unknown[];
    batches?: unknown[];
    runFails?: boolean;
    onRun?: () => void;
} = {}) {
    server.use(
        http.get(`${BASE}/workflows/wf-1/tests`, () => HttpResponse.json(fixtures)),
        http.get(`${BASE}/workflows/wf-1/evals/parked`, () => HttpResponse.json(parked)),
        http.get(`${BASE}/agent-tests/:id/batches`, () => HttpResponse.json(batches)),
        http.post(`${BASE}/agent-tests/:id/run`, () => {
            onRun?.();
            return runFails
                ? HttpResponse.json({ error: 'the worktree is locked' }, { status: 409 })
                : HttpResponse.json({ n_runs: 1, running: 1, runs: [] }, { status: 202 });
        }),
    );
    // `Toast` renders the confirmations and refusals `toast.show` queues;
    // without it the success/error handlers have nowhere to appear.
    return renderWithProviders(
        <>
            <WorkflowEvalsTab workflowId="wf-1" />
            <Toast />
        </>,
    );
}

describe('WorkflowEvalsTab', () => {
    it('explains why there are no fixtures rather than shrugging', async () => {
        mount();
        expect(await screen.findByText(/No fixtures point at this workflow yet/)).toBeInTheDocument();
    });

    it('lists a fixture with the item it runs and the set it belongs to', async () => {
        mount({ fixtures: [fixture()] });
        expect(await screen.findByText('ambiguous must escalate')).toBeInTheDocument();
        expect(screen.getByText(/Make the thing better · in "golden"/)).toBeInTheDocument();
    });

    // ATL-173: "if those parks are not an inbox in the UI, a set run from the
    // UI is worse than the CLI, not better." Every fixture parks once by
    // design, and across a set that is the slowest part of the exercise.
    it('puts the fixtures waiting on an answer at the top', async () => {
        mount({
            fixtures: [fixture()],
            parked: [
                {
                    run_id: 'r1',
                    agent_test_id: 'fx-1',
                    test_name: 'ambiguous must escalate',
                    workflow_run_id: 'wr-9',
                    item_id: 'ATL-2',
                    parked_node_id: 'po-writer',
                    park_reason: 'Which repo owns the health endpoint?',
                    started_at: '2026-09-25T10:00:00Z',
                },
            ],
        });
        expect(await screen.findByText('1 fixture is waiting on you')).toBeInTheDocument();
        // The second thing ATL-173 names: the reasons have to be visible
        // together, because two rulings on the same defect could contradict.
        expect(screen.getByText('Which repo owns the health endpoint?')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Answer' })).toHaveAttribute(
            'href',
            '/workflows/wf-1/runs/wr-9',
        );
    });

    it('says nothing about parks when none are waiting', async () => {
        mount({ fixtures: [fixture()] });
        await screen.findByText('ambiguous must escalate');
        expect(screen.queryByText(/waiting on you/)).not.toBeInTheDocument();
    });

    it('reports a flaky set run as flaky rather than as one verdict', async () => {
        mount({
            fixtures: [fixture()],
            batches: [
                {
                    batch_id: 'b1',
                    label: null,
                    created_at: '2026-09-25T10:00:00Z',
                    n_runs: 3,
                    passed: 2,
                    failed: 1,
                    errored: 0,
                    running: 0,
                    pass_at_1: true,
                    pass_at_k: true,
                    consistency: 2 / 3,
                    flaky: true,
                    failure_histogram: [{ failure: 'expected no pull request, 1 was opened', count: 1 }],
                    cost_usd: 31.5,
                    judge_cost_usd: 0,
                    duration_s_p50: 1800,
                    duration_s_p95: 2400,
                    runs: [],
                },
            ],
        });
        expect(await screen.findByText('2/3 passed · flaky')).toBeInTheDocument();
        expect(screen.getByText(/1 of 3 runs: expected no pull request/)).toBeInTheDocument();
    });

    it('starts an eval and says so', async () => {
        let ran = false;
        mount({ fixtures: [fixture()], onRun: () => { ran = true; } });
        await userEvent.click(await screen.findByRole('button', { name: 'Run' }));
        await waitFor(() => expect(ran).toBe(true));
        expect(await screen.findByText('Eval started')).toBeInTheDocument();
    });

    // One run of a delivery chain is dollars and tens of minutes; a refusal
    // that vanished silently would be the worst way to find out.
    it('surfaces why an eval could not start', async () => {
        mount({ fixtures: [fixture()], runFails: true });
        await userEvent.click(await screen.findByRole('button', { name: 'Run' }));
        expect(await screen.findByText(/the worktree is locked/)).toBeInTheDocument();
    });

    it('reports a batch that could not run at all as such, not as a failure', async () => {
        mount({
            fixtures: [fixture()],
            batches: [
                {
                    batch_id: 'b1', label: null, created_at: '2026-09-25T10:00:00Z',
                    n_runs: 1, passed: 0, failed: 0, errored: 1, running: 0,
                    pass_at_1: null, pass_at_k: false, consistency: null, flaky: false,
                    failure_histogram: [], cost_usd: 0, judge_cost_usd: 0,
                    duration_s_p50: null, duration_s_p95: null, runs: [],
                },
            ],
        });
        expect(await screen.findByText('could not run')).toBeInTheDocument();
    });

    it('shows a batch still in flight as running', async () => {
        mount({
            fixtures: [fixture()],
            batches: [
                {
                    batch_id: 'b1', label: null, created_at: '2026-09-25T10:00:00Z',
                    n_runs: 2, passed: 0, failed: 0, errored: 0, running: 2,
                    pass_at_1: null, pass_at_k: null, consistency: null, flaky: false,
                    failure_histogram: [], cost_usd: 0, judge_cost_usd: 0,
                    duration_s_p50: null, duration_s_p95: null, runs: [],
                },
            ],
        });
        expect(await screen.findByText('running…')).toBeInTheDocument();
    });

    it('reports a clean sweep as passed', async () => {
        mount({
            fixtures: [fixture({ suite: null })],
            batches: [
                {
                    batch_id: 'b1', label: null, created_at: '2026-09-25T10:00:00Z',
                    n_runs: 1, passed: 1, failed: 0, errored: 0, running: 0,
                    pass_at_1: true, pass_at_k: true, consistency: 1, flaky: false,
                    failure_histogram: [], cost_usd: 12, judge_cost_usd: 0,
                    duration_s_p50: 900, duration_s_p95: 900, runs: [],
                },
            ],
        });
        expect(await screen.findByText('passed')).toBeInTheDocument();
        // No suite tag when the fixture belongs to no set.
        expect(screen.getByText('Make the thing better')).toBeInTheDocument();
    });

    it('reports a failed batch as failed', async () => {
        mount({
            fixtures: [fixture()],
            batches: [
                {
                    batch_id: 'b1', label: null, created_at: '2026-09-25T10:00:00Z',
                    n_runs: 1, passed: 0, failed: 1, errored: 0, running: 0,
                    pass_at_1: false, pass_at_k: false, consistency: 0, flaky: false,
                    failure_histogram: [{ failure: 'expected a pull request, none was opened', count: 1 }],
                    cost_usd: 8, judge_cost_usd: 0, duration_s_p50: 600, duration_s_p95: 600, runs: [],
                },
            ],
        });
        expect(await screen.findByText('failed')).toBeInTheDocument();
        expect(screen.getByText(/expected a pull request/)).toBeInTheDocument();
    });

    it('says a fixture with no park reason recorded has none', async () => {
        mount({
            fixtures: [fixture()],
            parked: [
                {
                    run_id: 'r1', agent_test_id: 'fx-1', test_name: 'x', workflow_run_id: 'wr-9',
                    item_id: null, parked_node_id: null, park_reason: null,
                    started_at: '2026-09-25T10:00:00Z',
                },
            ],
        });
        expect(await screen.findByText('No reason recorded.')).toBeInTheDocument();
    });

    it('counts more than one fixture waiting in the plural', async () => {
        const park = (id: string) => ({
            run_id: id, agent_test_id: 'fx-1', test_name: `fixture ${id}`, workflow_run_id: `wr-${id}`,
            item_id: null, parked_node_id: 'po-writer', park_reason: 'which repo?',
            started_at: '2026-09-25T10:00:00Z',
        });
        mount({ fixtures: [fixture()], parked: [park('a'), park('b')] });
        expect(await screen.findByText('2 fixtures are waiting on you')).toBeInTheDocument();
    });

    it('reports a clean multi-sample sweep with its count', async () => {
        mount({
            fixtures: [fixture()],
            batches: [
                {
                    batch_id: 'b1', label: null, created_at: '2026-09-25T10:00:00Z',
                    n_runs: 3, passed: 3, failed: 0, errored: 0, running: 0,
                    pass_at_1: true, pass_at_k: true, consistency: 1, flaky: false,
                    failure_histogram: [], cost_usd: 30, judge_cost_usd: 0,
                    duration_s_p50: 900, duration_s_p95: 900, runs: [],
                },
            ],
        });
        expect(await screen.findByText('3/3 passed')).toBeInTheDocument();
    });
});
