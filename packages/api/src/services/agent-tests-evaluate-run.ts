import type { IRunOutcome } from '@atlas/shared';

import { db } from '../db/kysely-client.js';
import type { AgentTestVerdict, JudgeVerdict } from '../db/types.js';
import { evaluateAgentTest, type AgentTestExpectations } from './agent-tests-evaluate.js';

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
    agent_id: string;
    project_id: string;
    repo_id: string | null;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations: AgentTestExpectations;
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
}

function iso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : String(v ?? '');
}

export function asTest(r: Record<string, unknown>): AgentTestRow {
    return {
        id: r['id'] as string,
        agent_id: r['agent_id'] as string,
        project_id: r['project_id'] as string,
        repo_id: (r['repo_id'] as string) ?? null,
        name: r['name'] as string,
        item_template: r['item_template'] as AgentTestItemTemplate,
        expectations: (r['expectations'] as AgentTestExpectations) ?? {},
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
    };
}

/**
 * Judge one pending run, if its dispatch has finished.
 *
 * Still safe to call on read: `completeRun` is best-effort, and an API that
 * crashed between the dispatch finishing and the hook firing would otherwise
 * leave the run `running` for good.
 */
export async function judgePendingRun(run: AgentTestRunRow, test: AgentTestRow): Promise<AgentTestRunRow> {
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

    const requiredChecklist = await db
        .selectFrom('agent_checklists')
        .select(['id', 'label'])
        .where('agent_id', '=', test.agent_id)
        .where('required', '=', true)
        .execute();

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
