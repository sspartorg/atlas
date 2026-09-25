import type { IRunOutcome, IRunTraceSummary } from '@atlas/shared';

import { db } from '../db/kysely-client.js';
import type { AgentTestVerdict, JudgeVerdict } from '../db/types.js';
import { judgeAgentTestRun, type JudgeResult } from './agent-tests-judge.js';
import {
    evaluateAgentTest,
    type AgentTestExpectations,
    type WorkflowRunObservation,
} from './agent-tests-evaluate.js';

// Judging one test run, and the row shapes that judging needs.
//
// This lives apart from `agent-tests.ts` for one concrete reason: the runner
// has to call it the moment a dispatch finishes, and `agent-tests.ts` imports
// `spawnAgentRun` from `agent-runner.ts`. Putting the hook there would close a
// cycle. Both files import this one instead.
//
// **Why the hook exists at all.** Evaluation used to be lazy — a run was judged
// the first time somebody opened the Tests tab — on the grounds that
// `agent_runs` had no completion hook to attach to. It does: `completeRun`
// already runs the memory regeneration hook best-effort at exactly this point.
// So a test run that nobody happened to look at stayed `running` in the
// database forever, and its verdict depended on whether anyone was watching.

/** Statuses an `agent_runs` row can no longer move out of. */
const TERMINAL = new Set(['completed', 'error', 'cancelled', 'setup_failed']);

export interface AgentTestItemTemplate {
    issue_type: 'task' | 'sub_task';
    // `| undefined` throughout: these arrive parsed by zod, which produces an
    // explicit undefined for an absent optional, and the repo runs with
    // `exactOptionalPropertyTypes`.
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    labels?: string[] | undefined;
}

export interface AgentTestRow {
    id: string;
    /** Null when this fixture targets a workflow instead (migration 019). */
    agent_id: string | null;
    /** Migration 021 — null when the fixture binds to a project at run time. */
    project_id: string | null;
    repo_id: string | null;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations: AgentTestExpectations;
    /** Exactly one of `agent_id` / `workflow_id` is set, by CHECK. */
    workflow_id: string | null;
    suite: string | null;
    created_at: string;
    updated_at: string;
}

export interface AgentTestRunRow {
    id: string;
    agent_test_id: string;
    agent_run_id: string | null;
    item_id: string | null;
    verdict: AgentTestVerdict;
    failures: string[];
    cost_usd: number | null;
    duration_s: number | null;
    created_at: string;
    /** Migration 018 — one press of Run is a batch of `n` of these. */
    batch_id: string;
    sample_index: number;
    label: string | null;
    judge_verdict: JudgeVerdict | null;
    judge_reason: string | null;
    /** Apart from `cost_usd`: a judge must never fail a ceiling about the agent. */
    judge_cost_usd: number | null;
    /** Migration 019 — set for a workflow eval; judged on the whole run. */
    workflow_run_id: string | null;
}

function iso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : String(v ?? '');
}

export function asTest(r: Record<string, unknown>): AgentTestRow {
    return {
        id: r['id'] as string,
        agent_id: (r['agent_id'] as string) ?? null,
        project_id: (r['project_id'] as string | null) ?? null,
        repo_id: (r['repo_id'] as string) ?? null,
        name: r['name'] as string,
        item_template: r['item_template'] as AgentTestItemTemplate,
        expectations: (r['expectations'] as AgentTestExpectations) ?? {},
        workflow_id: (r['workflow_id'] as string) ?? null,
        suite: (r['suite'] as string) ?? null,
        created_at: iso(r['created_at']),
        updated_at: iso(r['updated_at']),
    };
}

export function asRun(r: Record<string, unknown>): AgentTestRunRow {
    return {
        id: r['id'] as string,
        agent_test_id: r['agent_test_id'] as string,
        agent_run_id: (r['agent_run_id'] as string) ?? null,
        item_id: (r['item_id'] as string) ?? null,
        verdict: r['verdict'] as AgentTestVerdict,
        failures: (r['failures'] as string[]) ?? [],
        cost_usd: r['cost_usd'] == null ? null : Number(r['cost_usd']),
        duration_s: r['duration_s'] == null ? null : Number(r['duration_s']),
        created_at: iso(r['created_at']),
        // `batch_id` is NOT NULL from migration 018 on; the fallback covers a
        // row read mid-migration rather than a shape that can persist.
        batch_id: (r['batch_id'] as string) ?? (r['id'] as string),
        sample_index: Number(r['sample_index'] ?? 0),
        label: (r['label'] as string) ?? null,
        judge_verdict: (r['judge_verdict'] as JudgeVerdict) ?? null,
        judge_reason: (r['judge_reason'] as string) ?? null,
        judge_cost_usd: r['judge_cost_usd'] == null ? null : Number(r['judge_cost_usd']),
        workflow_run_id: (r['workflow_run_id'] as string) ?? null,
    };
}

/**
 * Judge one pending run, if its dispatch has finished.
 *
 * Still safe to call on read: `completeRun` is best-effort, and an API that
 * crashed between the dispatch finishing and the hook firing would otherwise
 * leave the run `running` for good.
 */
/** Statuses a `workflow_runs` row can no longer move out of. Parked is not one. */
const WORKFLOW_TERMINAL = new Set(['completed', 'error', 'cancelled']);

/**
 * What a finished workflow run produced.
 *
 * Gate verdicts are gathered across the whole tree: ADR 0015 runs a Task's
 * sub-tasks as child runs, and a gate that went red inside one is still this
 * delivery's red gate.
 */
async function observeWorkflowRun(workflowRunId: string): Promise<WorkflowRunObservation | null> {
    const run = await db
        .selectFrom('workflow_runs')
        .select(['status', 'item_id', 'pr_urls'])
        .where('id', '=', workflowRunId)
        .executeTakeFirst();
    if (!run || !WORKFLOW_TERMINAL.has(run.status as string)) return null;

    const children = await db
        .selectFrom('workflow_runs')
        .select('id')
        .where('parent_workflow_run_id', '=', workflowRunId)
        .execute();
    const tree = [workflowRunId, ...children.map((c) => c.id)];

    const gates = await db
        .selectFrom('run_gate_results')
        .select('verdict')
        .where('workflow_run_id', 'in', tree)
        .execute();

    const subTasks = run.item_id
        ? await db
              .selectFrom('items')
              .select('id')
              .where('parent_id', '=', run.item_id)
              .where('type', '=', 'sub_task')
              .execute()
        : [];

    return {
        status: run.status as string,
        sub_task_count: subTasks.length,
        pr_count: Array.isArray(run.pr_urls) ? run.pr_urls.length : 0,
        gate_verdicts: gates.map((g) => g.verdict as string),
    };
}

/**
 * Judge a workflow eval once its run has finished.
 *
 * A parked run is NOT finished — ATL-173: every fixture parks once at PO
 * Writer's brainstorm by design, and the verdict has to wait for the answer.
 */
async function judgeWorkflowEval(run: AgentTestRunRow, test: AgentTestRow): Promise<AgentTestRunRow> {
    if (!run.workflow_run_id) return run;
    const wf = await observeWorkflowRun(run.workflow_run_id);
    if (!wf) return run;

    // The delivery's whole cost, not one dispatch's: an eval is judged on the
    // chain, and its `max_cost_usd` ceiling is about the chain.
    const spend = await db
        .selectFrom('agent_runs')
        .select(({ fn }) => [fn.sum<string>('total_cost_usd').as('cost')])
        .where('workflow_run_id', 'in', [
            run.workflow_run_id,
            ...(
                await db
                    .selectFrom('workflow_runs')
                    .select('id')
                    .where('parent_workflow_run_id', '=', run.workflow_run_id)
                    .execute()
            ).map((c) => c.id),
        ])
        .executeTakeFirst();
    const cost = spend?.cost == null ? null : Number(spend.cost);

    const timing = await db
        .selectFrom('workflow_runs')
        .select(['started_at', 'finished_at'])
        .where('id', '=', run.workflow_run_id)
        .executeTakeFirst();
    const from = timing?.started_at ? new Date(iso(timing.started_at)).getTime() : null;
    const to = timing?.finished_at ? new Date(iso(timing.finished_at)).getTime() : null;
    const duration = from && to ? Math.round((to - from) / 1000) : null;

    const evaluation = evaluateAgentTest(test.expectations, {
        // A workflow eval asserts on the delivery, not on any one dispatch's
        // self-report, so there is no outcome block to read.
        outcome: null,
        workflow: wf,
        requiredChecklist: [],
        cost_usd: cost,
        duration_s: duration,
        ran: wf.status === 'completed' || wf.status === 'error',
    });

    await db
        .updateTable('agent_test_runs')
        .set({
            verdict: evaluation.verdict,
            failures: JSON.stringify(evaluation.failures),
            cost_usd: cost,
            duration_s: duration,
            evaluated_at: new Date().toISOString(),
        } as never)
        .where('id', '=', run.id)
        .execute();

    return { ...run, verdict: evaluation.verdict, failures: evaluation.failures, cost_usd: cost, duration_s: duration };
}

export async function judgePendingRun(run: AgentTestRunRow, test: AgentTestRow): Promise<AgentTestRunRow> {
    if (run.workflow_run_id) return judgeWorkflowEval(run, test);
    if (!run.agent_run_id) return run;
    const ar = await db
        .selectFrom('agent_runs')
        .select([
            'status',
            'outcome_kind',
            'outcome_summary',
            'outcome_reason',
            'outcome_checklist',
            'total_cost_usd',
            'started_at',
            'completed_at',
            // Migration 017 — what the run did, for the expectations that ask.
            'trace_summary',
        ])
        .where('id', '=', run.agent_run_id)
        .executeTakeFirst();
    if (!ar || !TERMINAL.has(ar.status as string)) return run;

    const outcome: IRunOutcome | null = ar.outcome_kind
        ? ({
              kind: ar.outcome_kind,
              summary: ar.outcome_summary ?? '',
              reason: ar.outcome_reason ?? undefined,
              checklist: ar.outcome_checklist ?? undefined,
          } as IRunOutcome)
        : null;

    const requiredChecklist = test.agent_id
        ? await db
              .selectFrom('agent_checklists')
              .select(['id', 'label'])
              .where('agent_id', '=', test.agent_id)
              .where('required', '=', true)
              .execute()
        : [];

    const startedAt = ar.started_at ? new Date(iso(ar.started_at)).getTime() : null;
    const completedAt = ar.completed_at ? new Date(iso(ar.completed_at)).getTime() : null;
    const duration = startedAt && completedAt ? Math.round((completedAt - startedAt) / 1000) : null;
    const cost = ar.total_cost_usd == null ? null : Number(ar.total_cost_usd);

    const evaluation = evaluateAgentTest(test.expectations, {
        outcome,
        trace: ar.trace_summary,
        requiredChecklist: requiredChecklist.map((c) => ({ id: Number(c.id), label: c.label })),
        cost_usd: cost,
        duration_s: duration,
        ran: ar.status === 'completed',
    });

    // ── The judge (ADR 0023) ─────────────────────────────────────────────
    //
    // Run only when the test asked for it. A judge that could not run is
    // `errored`, never a pass and never the agent's fault — blaming an agent
    // for a missing binary is the mistake this file already refuses to make
    // about the dispatch itself. Every judge-authored failure carries a
    // `judge:` prefix, so a reader can always tell which assertion was
    // machine-graded.
    const judged = await runJudge(test, outcome, ar.trace_summary);
    const failures = [...evaluation.failures, ...judged.failures];
    const verdict: typeof evaluation.verdict =
        evaluation.verdict === 'errored' || judged.errored
            ? 'errored'
            : failures.length === 0
              ? 'passed'
              : 'failed';

    await db
        .updateTable('agent_test_runs')
        .set({
            verdict,
            failures: JSON.stringify(failures),
            cost_usd: cost,
            duration_s: duration,
            judge_verdict: judged.result?.verdict ?? null,
            judge_reason: judged.result?.reason ?? null,
            judge_cost_usd: judged.result?.cost_usd ?? null,
            evaluated_at: new Date().toISOString(),
        } as never)
        .where('id', '=', run.id)
        .execute();

    return {
        ...run,
        verdict,
        failures,
        cost_usd: cost,
        duration_s: duration,
        judge_verdict: judged.result?.verdict ?? null,
        judge_reason: judged.result?.reason ?? null,
        judge_cost_usd: judged.result?.cost_usd ?? null,
    };
}

/** The judge's answer, in the shape the verdict above needs. */
async function runJudge(
    test: AgentTestRow,
    outcome: IRunOutcome | null,
    trace: IRunTraceSummary | null,
): Promise<{ result: JudgeResult | null; failures: string[]; errored: boolean }> {
    const criteria = test.expectations.judge_criteria;
    if (!criteria || criteria.length === 0) return { result: null, failures: [], errored: false };

    let result: JudgeResult | null;
    try {
        result = await judgeAgentTestRun(criteria, {
            summary: outcome?.summary ?? '',
            reason: outcome?.reason ?? null,
            trace,
        });
    } catch (err) {
        return { result: null, failures: [`judge: could not run (${(err as Error).message})`], errored: true };
    }

    // AI is off, so the question was never asked. Not a pass.
    if (!result) {
        return {
            result: null,
            failures: ['judge: this test has criteria to grade, but AI is not enabled here'],
            errored: true,
        };
    }
    if (result.verdict === 'abstained') {
        return { result, failures: [`judge: could not decide (${result.reason})`], errored: true };
    }
    if (result.verdict === 'fail') {
        return { result, failures: [`judge: ${result.reason}`], errored: false };
    }
    return { result, failures: [], errored: false };
}

/**
 * The completion hook: judge whatever test is waiting on this dispatch.
 *
 * A no-op for the overwhelming majority of runs, which are not tests at all —
 * one indexed lookup that finds nothing.
 */
export async function evaluateAgentTestRun(agentRunId: string): Promise<void> {
    const row = await db
        .selectFrom('agent_test_runs')
        .selectAll()
        .where('agent_run_id', '=', agentRunId)
        .where('verdict', '=', 'running')
        .executeTakeFirst();
    if (!row) return;
    const test = await db
        .selectFrom('agent_tests')
        .selectAll()
        .where('id', '=', row.agent_test_id)
        .executeTakeFirst();
    if (!test) return;
    await judgePendingRun(asRun(row as never), asTest(test as never));
}
