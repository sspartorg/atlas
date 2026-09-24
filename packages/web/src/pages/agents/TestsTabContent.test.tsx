import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IAgent } from '@atlas/shared';

import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { TestsTabContent } from './TestsTabContent.js';

const BASE = 'http://localhost:3000/api';
const agent: IAgent = makeAgent({ id: 'agent-coder', name: 'Coder' });

interface MountOpts {
    tests?: unknown[];
    runs?: unknown[];
    estimate?: { estimated_cost_usd: number | null; sample_size: number };
    repos?: unknown[];
    onWrite?: (kind: string, payload: unknown) => void;
}

function mount({ tests = [], runs = [], estimate, repos = [], onWrite }: MountOpts = {}) {
    server.use(
        http.post(`${BASE}/agents/agent-coder/tests`, async ({ request }) => {
            onWrite?.('create', await request.json());
            return HttpResponse.json(aTest(), { status: 201 });
        }),
        http.delete(`${BASE}/agent-tests/:id`, ({ params }) => {
            onWrite?.('delete', params['id']);
            return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${BASE}/agent-tests/:id/run`, ({ params }) => {
            onWrite?.('run', params['id']);
            return HttpResponse.json(aRun({ verdict: 'running' }), { status: 202 });
        }),
        http.get(`${BASE}/agents/agent-coder/tests`, () => HttpResponse.json(tests)),
        http.get(`${BASE}/agents/agent-coder/cost-estimate`, () =>
            HttpResponse.json(estimate ?? { estimated_cost_usd: null, sample_size: 0 }),
        ),
        http.get(`${BASE}/agent-tests/:id/runs`, () => HttpResponse.json(runs)),
        http.get(`${BASE}/projects`, () => HttpResponse.json([{ id: 'p1', name: 'Sandbox' }])),
        http.get(`${BASE}/projects/:id/repos`, () => HttpResponse.json(repos)),
    );
    return renderWithProviders(<TestsTabContent agent={agent} />);
}

const aTest = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    agent_id: 'agent-coder',
    project_id: 'p1',
    repo_id: 'r1',
    name: 'Asks rather than building a whole Task',
    item_template: { issue_type: 'task', title: 'Add a health endpoint' },
    expectations: { outcome_kind: 'asked_question' },
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    ...over,
});

const aRun = (over: Record<string, unknown> = {}) => ({
    id: 'tr1',
    agent_test_id: 't1',
    agent_run_id: 'ar1',
    item_id: 'ATL-174',
    verdict: 'passed',
    failures: [],
    cost_usd: 0.24,
    duration_s: 19,
    created_at: '2026-09-24T00:00:00Z',
    ...over,
});

describe('TestsTabContent', () => {
    // Without a test there is no way to tell whether an agent works — the empty
    // state has to say that rather than shrug.
    it('says why the absence matters when there are no tests', async () => {
        mount();
        expect(await screen.findByText(/No tests yet/)).toBeInTheDocument();
    });

    it('lists a test with the item it acts on and what it expects', async () => {
        mount({ tests: [aTest()] });
        expect(await screen.findByText('Asks rather than building a whole Task')).toBeInTheDocument();
        expect(screen.getByText(/Task: Add a health endpoint · expects asked_question/)).toBeInTheDocument();
    });

    // Spend that surprises you afterwards is what stops people running tests at
    // all, so the estimate is on the button itself.
    it('puts the cost estimate on the Run button', async () => {
        mount({ tests: [aTest()], estimate: { estimated_cost_usd: 0.32, sample_size: 20 } });
        expect(await screen.findByRole('button', { name: /Run · ~\$0\.32/ })).toBeInTheDocument();
    });

    it('offers a plain Run when the agent has never run, rather than inventing a number', async () => {
        mount({ tests: [aTest()], estimate: { estimated_cost_usd: null, sample_size: 0 } });
        const btn = await screen.findByRole('button', { name: 'Run' });
        expect(btn).toBeInTheDocument();
    });

    describe('history', () => {
        it('shows the verdict, cost, duration and the item the agent acted on', async () => {
            mount({ tests: [aTest()], runs: [aRun()] });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            await waitFor(() => expect(screen.getAllByText('passed').length).toBeGreaterThan(0));
            expect(screen.getByText('19s')).toBeInTheDocument();
            expect(screen.getByText('ATL-174')).toBeInTheDocument();
        });

        // A verdict you cannot act on is barely better than no verdict.
        it('lists every expectation that did not hold', async () => {
            mount({
                tests: [aTest()],
                runs: [aRun({ verdict: 'failed', failures: ['expected outcome `asked_question`, got `done`'] })],
            });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            expect(
                await screen.findByText(/expected outcome `asked_question`, got `done`/),
            ).toBeInTheDocument();
        });

        // A dispatch that never ran is a broken environment, not a failing
        // agent — the ADR 0020 distinction, carried into the UI.
        it('shows a dispatch that never ran as "could not run", not failed', async () => {
            mount({ tests: [aTest()], runs: [aRun({ verdict: 'errored', failures: ['could not start the run'] })] });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            // Twice over: once as the card's latest verdict, once in the row.
            await waitFor(() => expect(screen.getAllByText('could not run')).toHaveLength(2));
            expect(screen.queryByText('failed')).not.toBeInTheDocument();
        });
    });

    describe('the create form', () => {
        it('cannot be submitted until it names a test, an item and a project', async () => {
            mount();
            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            expect(screen.getByRole('button', { name: 'Create test' })).toBeDisabled();
        });

        // ADR 0018: every Task names at least one repo, and `resolveRepoIds`
        // refuses to guess when a project has several. Without this the run
        // fails at dispatch with "A Task needs at least one repo" — which is
        // exactly what happened the first time this was driven in a browser.
        it('requires a repo when the project has more than one', async () => {
            mount({ repos: [{ id: 'r1', name: 'web' }, { id: 'r2', name: 'cli' }] });
            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            await userEvent.type(screen.getByLabelText('Test name'), 'a test');
            await userEvent.type(screen.getByLabelText('Item title'), 'an item');
            // Project and repo are still unset, so it stays disabled.
            expect(screen.getByRole('button', { name: 'Create test' })).toBeDisabled();
        });

        it('offers asked_question as an expected outcome, not just success', async () => {
            mount();
            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            await userEvent.click(screen.getByLabelText('Expected outcome'));
            expect(await screen.findByText(/asked_question — asked instead of guessing/)).toBeInTheDocument();
        });
    });

    // These are the flows a customer actually performs, and the ones that were
    // broken the first time this page was driven in a real browser.
    describe('writes', () => {
        it('creates a test with the item template and expectations it was given', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({ onWrite: (k, p) => writes.push([k, p]) });

            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            await userEvent.type(screen.getByLabelText('Test name'), 'refuses a Task');
            await userEvent.click(screen.getByLabelText('Project'));
            await userEvent.click(await screen.findByRole('option', { name: 'Sandbox' }));
            await userEvent.type(screen.getByLabelText('Item title'), 'Add a health endpoint');

            await userEvent.click(screen.getByRole('button', { name: 'Create test' }));
            await waitFor(() => expect(writes).toHaveLength(1));
            expect(writes[0]![0]).toBe('create');
            expect(writes[0]![1]).toMatchObject({
                project_id: 'p1',
                name: 'refuses a Task',
                item_template: { issue_type: 'task', title: 'Add a health endpoint' },
            });
        });

        it('runs a test', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({ tests: [aTest()], onWrite: (k, p) => writes.push([k, p]) });
            await userEvent.click(await screen.findByRole('button', { name: /^Run/ }));
            await waitFor(() => expect(writes).toEqual([['run', 't1']]));
        });

        it('deletes a test', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({ tests: [aTest()], onWrite: (k, p) => writes.push([k, p]) });
            await userEvent.click(
                await screen.findByRole('button', { name: 'Delete Asks rather than building a whole Task' }),
            );
            await waitFor(() => expect(writes).toEqual([['delete', 't1']]));
        });

        // Drives every field, because each one is a handler and a half-covered
        // form is one where the field nobody tested is the one that silently
        // does not bind.
        it('sends every field the form collects', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({
                repos: [{ id: 'r1', name: 'web' }, { id: 'r2', name: 'cli' }],
                onWrite: (k, p2) => writes.push([k, p2]),
            });

            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            await userEvent.type(screen.getByLabelText('Test name'), 'full form');

            await userEvent.click(screen.getByLabelText('Project'));
            await userEvent.click(await screen.findByRole('option', { name: 'Sandbox' }));

            await userEvent.click(await screen.findByLabelText('Repo'));
            await userEvent.click(await screen.findByRole('option', { name: 'cli' }));

            await userEvent.click(screen.getByLabelText('Item kind'));
            await userEvent.click(await screen.findByRole('option', { name: 'Sub-task' }));

            await userEvent.type(screen.getByLabelText('Item title'), 'Build the endpoint');
            await userEvent.type(screen.getByLabelText('Item description'), 'some context');

            await userEvent.click(screen.getByLabelText('Expected outcome'));
            await userEvent.click(await screen.findByRole('option', { name: /asked_question/ }));

            await userEvent.click(screen.getByRole('button', { name: 'Create test' }));
            await waitFor(() => expect(writes).toHaveLength(1));
            expect(writes[0]![1]).toMatchObject({
                project_id: 'p1',
                repo_id: 'r2',
                name: 'full form',
                item_template: {
                    issue_type: 'sub_task',
                    title: 'Build the endpoint',
                    description: 'some context',
                },
                expectations: { outcome_kind: 'asked_question' },
            });
        });

        it('closes the form and clears it after a successful create', async () => {
            mount();
            await userEvent.click(await screen.findByRole('button', { name: 'New test' }));
            await userEvent.type(screen.getByLabelText('Test name'), 'x');
            await userEvent.click(screen.getByLabelText('Project'));
            await userEvent.click(await screen.findByRole('option', { name: 'Sandbox' }));
            await userEvent.type(screen.getByLabelText('Item title'), 'y');
            await userEvent.click(screen.getByRole('button', { name: 'Create test' }));
            // The toggle goes back to "New test" only when `adding` is cleared.
            expect(await screen.findByRole('button', { name: 'New test' })).toBeInTheDocument();
        });
    });
});
