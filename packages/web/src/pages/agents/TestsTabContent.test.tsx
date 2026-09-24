import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IAgent } from '@atlas/shared';

import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { TestsTabContent } from './TestsTabContent.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';
const agent: IAgent = makeAgent({ id: 'agent-coder', name: 'Coder' });

interface MountOpts {
    tests?: unknown[];
    /** Samples of ONE batch. `batches` takes precedence when both are given. */
    runs?: Array<Record<string, unknown>>;
    batches?: unknown[];
    estimate?: Record<string, unknown>;
    starters?: unknown[];
    repos?: unknown[];
    failWrites?: boolean;
    onWrite?: (kind: string, payload: unknown) => void;
}

/** What the API returns for a set of samples — the fold the service performs. */
function aBatch(samples: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
    const runs = samples.map((r, i) => ({ ...aRun(r), id: `tr${i}`, sample_index: i }));
    const passed = runs.filter((r) => r.verdict === 'passed').length;
    const errored = runs.filter((r) => r.verdict === 'errored').length;
    const running = runs.filter((r) => r.verdict === 'running').length;
    const judged = runs.length - errored;
    const counts = new Map<string, number>();
    for (const r of runs) for (const f of r.failures as string[]) counts.set(f, (counts.get(f) ?? 0) + 1);
    return {
        batch_id: 'b1',
        label: null,
        created_at: '2026-09-24T00:00:00Z',
        n_runs: runs.length,
        passed,
        failed: runs.length - passed - errored - running,
        errored,
        running,
        pass_at_1: runs[0]?.verdict === 'passed',
        pass_at_k: passed > 0,
        consistency: judged === 0 ? null : passed / judged,
        flaky: running === 0 && passed > 0 && passed < judged,
        failure_histogram: [...counts].map(([failure, count]) => ({ failure, count })),
        cost_usd: runs.reduce((n, r) => n + ((r.cost_usd as number) ?? 0), 0),
        judge_cost_usd: 0,
        duration_s_p50: (runs[0]?.duration_s as number) ?? null,
        duration_s_p95: (runs[0]?.duration_s as number) ?? null,
        runs,
        ...over,
    };
}

function mount({ tests = [], runs, batches, estimate, starters = [], repos = [], failWrites = false, onWrite }: MountOpts = {}) {
    const history = batches ?? (runs ? [aBatch(runs)] : []);
    server.use(
        http.post(`${BASE}/agents/agent-coder/tests`, async ({ request }) => {
            onWrite?.('create', await request.json());
            if (failWrites) return HttpResponse.json({ error: 'that project has no repos' }, { status: 400 });
            return HttpResponse.json(aTest(), { status: 201 });
        }),
        http.delete(`${BASE}/agent-tests/:id`, ({ params }) => {
            onWrite?.('delete', params['id']);
            return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${BASE}/agent-tests/:id/run`, async ({ params, request }) => {
            onWrite?.('run', { id: params['id'], body: await request.json() });
            if (failWrites) return HttpResponse.json({ error: 'the CLI is not installed' }, { status: 500 });
            return HttpResponse.json(aBatch([{ verdict: 'running' }]), { status: 202 });
        }),
        http.get(`${BASE}/agents/agent-coder/tests`, () => HttpResponse.json(tests)),
        http.get(`${BASE}/agents/agent-coder/cost-estimate`, ({ request }) => {
            const n = Number(new URL(request.url).searchParams.get('n') ?? '1');
            const base = estimate ?? { estimated_cost_usd: null, sample_size: 0 };
            const per = base['estimated_cost_usd'] as number | null;
            return HttpResponse.json({
                ...base,
                n_runs: n,
                // The server multiplies by n; the button shows the TOTAL.
                estimated_total_usd: per === null ? null : Number((per * n).toFixed(4)),
                estimated_range_usd: per === null ? null : [per * n, per * n],
            });
        }),
        http.get(`${BASE}/agent-tests/:id/batches`, () => HttpResponse.json(history)),
        http.get(`${BASE}/agents/agent-coder/starter-tests`, () => HttpResponse.json(starters)),
        http.get(`${BASE}/projects`, () => HttpResponse.json([{ id: 'p1', name: 'Sandbox' }])),
        http.get(`${BASE}/projects/:id/repos`, () => HttpResponse.json(repos)),
    );
    // `Toast` renders what `toast.show` queues; without it the success and
    // error handlers have nowhere to appear.
    return renderWithProviders(
        <>
            <TestsTabContent agent={agent} />
            <Toast />
        </>,
    );
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
    batch_id: 'b1',
    sample_index: 0,
    label: null,
    judge_verdict: null,
    judge_reason: null,
    judge_cost_usd: null,
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

    // Running a test spends real money; a refusal that vanished silently
    // would be the worst way to find out it did not start.
    it('says why a test could not start', async () => {
        mount({ tests: [aTest()], failWrites: true });
        await userEvent.click(await screen.findByRole('button', { name: /^Run/ }));
        expect(await screen.findByText(/the CLI is not installed/)).toBeInTheDocument();
    });

    it('confirms when a single test starts, and when several do', async () => {
        mount({ tests: [aTest()] });
        await userEvent.click(await screen.findByRole('button', { name: /^Run/ }));
        expect(await screen.findByText('Test started')).toBeInTheDocument();
    });

    it('covers every kind of assertion in the summary line', async () => {
        mount({
            tests: [
                aTest({
                    expectations: {
                        required_checklist_all_passed: true,
                        summary_contains: ['migration'],
                        summary_omits: ['TODO'],
                        tools_required: ['Read'],
                        max_tool_calls: 40,
                        files_touched: ['src/'],
                        judge_criteria: ['did it say why?'],
                        max_duration_s: 300,
                    },
                }),
            ],
        });
        const line = await screen.findByText(/^Checks:/);
        expect(line).toHaveTextContent('every required checklist row passed');
        expect(line).toHaveTextContent('says "migration"');
        expect(line).toHaveTextContent('does not say "TODO"');
        expect(line).toHaveTextContent('uses `Read`');
        expect(line).toHaveTextContent('≤ 40 tool calls');
        expect(line).toHaveTextContent('touches src/');
        expect(line).toHaveTextContent('judged: did it say why?');
        expect(line).toHaveTextContent('under 300s');
    });

    it('says how far through a multi-sample batch is while it runs', async () => {
        mount({
            tests: [aTest()],
            runs: [{ verdict: 'passed' }, { verdict: 'running' }, { verdict: 'running' }],
        });
        expect(await screen.findAllByText('running 1/3…')).not.toHaveLength(0);
    });

    it('shows the label a batch was run under', async () => {
        mount({ tests: [aTest()], batches: [aBatch([{}], { label: 'before-prompt-diet' })] });
        expect(await screen.findByText('before-prompt-diet')).toBeInTheDocument();
    });

    // Expectations arrive from the API, from MCP and with starter tests — not
    // only from the one field the create form offers. A test whose assertions
    // you cannot see is half a test.
    it('says everything the test checks, not just the outcome', async () => {
        mount({
            tests: [
                aTest({
                    expectations: {
                        outcome_kind: 'rejected',
                        tools_forbidden: ['Edit', 'Write'],
                        max_turns: 12,
                        files_untouched: ['src/'],
                        max_cost_usd: 0.5,
                    },
                }),
            ],
        });
        const line = await screen.findByText(/^Checks:/);
        expect(line).toHaveTextContent('never uses `Edit`');
        expect(line).toHaveTextContent('never uses `Write`');
        expect(line).toHaveTextContent('≤ 12 turns');
        expect(line).toHaveTextContent('leaves src/ alone');
        expect(line).toHaveTextContent('under $0.5');
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
            mount({ tests: [aTest()], runs: [{}] });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            await waitFor(() => expect(screen.getAllByText('passed').length).toBeGreaterThan(0));
            expect(screen.getByText('19s median')).toBeInTheDocument();
        });

        // A verdict you cannot act on is barely better than no verdict.
        it('lists every expectation that did not hold', async () => {
            mount({
                tests: [aTest()],
                runs: [{ verdict: 'failed', failures: ['expected outcome `asked_question`, got `done`'] }],
            });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            expect(
                await screen.findByText(/expected outcome `asked_question`, got `done`/),
            ).toBeInTheDocument();
        });

        // A dispatch that never ran is a broken environment, not a failing
        // agent — the ADR 0020 distinction, carried into the UI.
        it('shows a dispatch that never ran as "could not run", not failed', async () => {
            mount({ tests: [aTest()], runs: [{ verdict: 'errored', failures: ['could not start the run'] }] });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            // Twice over: once as the card's headline, once in the batch block.
            await waitFor(() => expect(screen.getAllByText('could not run')).toHaveLength(2));
            expect(screen.queryByText('failed')).not.toBeInTheDocument();
        });
    });

    // "I don't see already pre-built tests for agent to evaluate work" — a
    // customer installing an agent from the marketplace does it on trust, and
    // these are what make "does this work?" pressable on day one.
    describe('tests the agent ships with', () => {
        const starter = {
            id: 'refuses-a-sub-task',
            name: 'Refuses work that is not a Task',
            item_template: { issue_type: 'sub_task', title: 'Add a spinner' },
            expectations: { outcome_kind: 'asked_question', tools_forbidden: ['Edit'], max_cost_usd: 0.6 },
            needs_repo: false,
            notes: "PO Writer's kind guard. A `done` here means the guard is gone.",
        };

        it('lists them with what each one catches', async () => {
            mount({ starters: [starter] });
            expect(await screen.findByText('Tests this agent ships with')).toBeInTheDocument();
            expect(screen.getByText(/kind guard/)).toBeInTheDocument();
        });

        // A permanent strip of things you have already done is noise.
        it('stops offering one that has already been added', async () => {
            mount({ starters: [starter], tests: [aTest({ name: starter.name })] });
            await screen.findByText(starter.name);
            expect(screen.queryByText('Tests this agent ships with')).not.toBeInTheDocument();
        });

        // Through the form, not a one-click create: a test needs a project to
        // make its throwaway item in, which a catalog bundle cannot know.
        it('prefills the form rather than creating it blind', async () => {
            mount({ starters: [starter] });
            await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
            expect(screen.getByLabelText('Test name')).toHaveValue(starter.name);
            expect(screen.getByLabelText('Item title')).toHaveValue('Add a spinner');
            expect(screen.getByRole('button', { name: 'Create test' })).toBeDisabled();
        });

        // The form can only show the outcome. Dropping the rest on adoption
        // would make the adopted copy weaker than the one it came from.
        it('keeps every assertion the shipped test made, not just the outcome', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({ starters: [starter], onWrite: (k, p) => writes.push([k, p]) });
            await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
            await userEvent.click(screen.getByLabelText('Project'));
            await userEvent.click(await screen.findByRole('option', { name: 'Sandbox' }));
            await userEvent.click(screen.getByRole('button', { name: 'Create test' }));

            await waitFor(() => expect(writes).toHaveLength(1));
            expect((writes[0]?.[1] as { expectations: unknown }).expectations).toEqual({
                outcome_kind: 'asked_question',
                tools_forbidden: ['Edit'],
                max_cost_usd: 0.6,
            });
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

    // Sampling. An agent is stochastic, so one run's verdict was whichever of
    // two answers the Owner happened to press the button on.
    describe('sampling', () => {
        it('reports how many of a batch’s samples passed, not a single verdict', async () => {
            mount({
                tests: [aTest()],
                runs: [{ verdict: 'passed' }, { verdict: 'failed' }, { verdict: 'passed' }],
            });
            // Twice: the card headline, and the batch block inside the
            // collapsed history (MUI keeps Collapse children mounted).
            await waitFor(() => expect(screen.getAllByText('2/3 passed')).toHaveLength(2));
            expect(screen.getAllByText('· flaky')).toHaveLength(2);
        });

        // A batch that says "1 of 3 failed" is less useful than one that says
        // WHICH expectation was the unstable one.
        it('says which expectation was unstable, and in how many runs', async () => {
            mount({
                tests: [aTest()],
                runs: [{ verdict: 'passed' }, { verdict: 'failed', failures: ['summary does not mention "migration"'] }],
            });
            await userEvent.click(await screen.findByRole('button', { name: 'History' }));
            expect(
                await screen.findByText(/1 of 2 runs: summary does not mention "migration"/),
            ).toBeInTheDocument();
        });

        // A dispatch that never started is not a wrong answer, so it must not
        // drag the score down with it.
        it('keeps a broken environment out of the score', async () => {
            mount({ tests: [aTest()], runs: [{ verdict: 'passed' }, { verdict: 'errored' }] });
            // One sample errored, so one was judged — and it passed. The
            // broken dispatch is reported beside the score, not inside it.
            await waitFor(() => expect(screen.getAllByText('passed')).toHaveLength(2));
            expect(screen.getAllByText('· 1 could not run')).toHaveLength(2);
        });

        // `5×` silently costing five times over is exactly the surprise ADR
        // 0023 says stops people running tests at all.
        it('shows the total for n runs on the button, not the per-run price', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({
                tests: [aTest()],
                estimate: { estimated_cost_usd: 0.2, sample_size: 20 },
                onWrite: (k, p) => writes.push([k, p]),
            });
            expect(await screen.findByRole('button', { name: /Run · ~\$0\.20/ })).toBeInTheDocument();

            await userEvent.click(screen.getByLabelText(/^Samples for/));
            await userEvent.click(await screen.findByRole('option', { name: '5×' }));
            expect(await screen.findByRole('button', { name: /Run · ~\$1\.00/ })).toBeInTheDocument();

            await userEvent.click(screen.getByRole('button', { name: /^Run/ }));
            await waitFor(() => expect(writes).toEqual([['run', { id: 't1', body: { n_runs: 5 } }]]));
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

        it('runs a test once by default', async () => {
            const writes: Array<[string, unknown]> = [];
            mount({ tests: [aTest()], onWrite: (k, p) => writes.push([k, p]) });
            await userEvent.click(await screen.findByRole('button', { name: /^Run/ }));
            await waitFor(() =>
                expect(writes).toEqual([['run', { id: 't1', body: { n_runs: 1 } }]]),
            );
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
