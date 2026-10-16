import { sql } from 'kysely';
import {
    WORKFLOW_PARK_KIND_LABELS,
    type AnalyticsWindow,
    type AnalyticsWorkflowsTrendKey,
    type IAnalyticsTrend,
    type IAnalyticsWorkflows,
    type WorkflowParkKind,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { fleetPerformance, iso } from './agent-scorecard.js';
import { notTestRun, ratio, resolveWindow, trendOf, windowBuckets } from './analytics-window.js';

// Workflow analytics: how the runs went, per workflow, plus each agent's row.
//
// Runs are top-level `workflow_runs` started in the window (a sub-task's run
// is part of its Task's run, ADR 0015), with agent-test items left out. The
// agent rows are the fleet page's (`shapeAgent`), in name order — a
// comparison, not a leaderboard (ADR 0023) — with agent tests left out too,
// unlike the Fleet performance page.

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** What one window's tiles are computed from. Every list carries its bucket. */
type Facts = {
    runs: Array<{ bucket: string; status: string }>;
    gates: Array<{ bucket: string; verdict: string }>;
    /** Agent dispatches created in the window; `task` is the Task it worked for (a sub-task's parent). */
    dispatches: Array<{ bucket: string; retry: boolean; task: string | null }>;
};

async function windowFacts(start: string, end: string, tz: string, unit: 'day' | 'week'): Promise<Facts> {
    const bucket = (col: string) => sql<string>`to_char(date_trunc(${unit}, ${sql.ref(col)} AT TIME ZONE ${tz}), 'YYYY-MM-DD')`;
    const [runs, gates, dispatches] = await Promise.all([
        sql<{ bucket: string; status: string }>`
            SELECT ${bucket('r.started_at')} AS bucket, r.status
              FROM workflow_runs r
             WHERE r.parent_workflow_run_id IS NULL AND ${notTestRun('r.item_id')}
               AND r.started_at >= ${start}::timestamptz AND r.started_at < ${end}::timestamptz
        `.execute(db),
        sql<{ bucket: string; verdict: string }>`
            SELECT ${bucket('g.created_at')} AS bucket, g.verdict
              FROM run_gate_results g
              JOIN workflow_runs r ON r.id = g.workflow_run_id
              LEFT JOIN items i ON i.id = r.item_id
             WHERE NOT COALESCE(i.is_test, false)
               AND g.created_at >= ${start}::timestamptz AND g.created_at < ${end}::timestamptz
        `.execute(db),
        sql<{ bucket: string; retry: boolean; task: string | null }>`
            SELECT ${bucket('a.created_at')} AS bucket, a.parent_run_id IS NOT NULL AS retry,
                   CASE WHEN i.type = 'sub_task' THEN i.parent_id ELSE i.id END AS task
              FROM agent_runs a
              LEFT JOIN items i ON i.id = a.item_id
             WHERE NOT COALESCE(i.is_test, false)
               AND a.created_at >= ${start}::timestamptz AND a.created_at < ${end}::timestamptz
        `.execute(db),
    ]);
    return { runs: runs.rows, gates: gates.rows, dispatches: dispatches.rows };
}

const count = (f: Facts, status: string) => f.runs.filter((r) => r.status === status).length;
const verdicts = (f: Facts, v: string) => f.gates.filter((g) => g.verdict === v).length;
const retriesOf = (f: Facts) => f.dispatches.filter((d) => d.retry).length;
const tasksOf = (f: Facts) => new Set(f.dispatches.map((d) => d.task).filter((t): t is string => t !== null)).size;

const METRICS: Record<AnalyticsWorkflowsTrendKey, (f: Facts) => number | null> = {
    success_rate: (f) => ratio(count(f, 'completed'), count(f, 'completed') + count(f, 'cancelled') + count(f, 'error')),
    runs: (f) => f.runs.length,
    gate_pass_rate: (f) => ratio(verdicts(f, 'pass'), verdicts(f, 'pass') + verdicts(f, 'fail')),
    retries: (f) => retriesOf(f),
    retries_per_task: (f) => ratio(retriesOf(f), tasksOf(f)),
};

function tally(f: Facts) {
    return {
        total: f.runs.length,
        completed: count(f, 'completed'),
        cancelled: count(f, 'cancelled'),
        error: count(f, 'error'),
        waiting_for_owner: count(f, 'waiting_for_owner'),
        running: count(f, 'running'),
        success_rate: METRICS.success_rate(f),
    };
}

export async function workflowAnalytics(opts: {
    tz: string;
    window: AnalyticsWindow;
    now?: Date;
}): Promise<IAnalyticsWorkflows> {
    const period = await resolveWindow(opts.tz, opts.window, opts.now);
    const { tz, start, end, previous_start: pStart, previous_end: pEnd, bucket: unit } = period;

    const [cur, prev, buckets, perWorkflow, parks, gateFailures, fleet] = await Promise.all([
        windowFacts(start, end, tz, unit),
        windowFacts(pStart, pEnd, tz, unit),
        windowBuckets(period),
        // A run's cost is its whole tree: its own steps plus its sub-task runs'.
        sql<{
            workflow_id: string;
            name: string | null;
            runs: string;
            completed: string;
            finished: string;
            median_s: string | null;
            avg_loops: string | null;
            avg_gate_rounds: string | null;
            cost: string | null;
        }>`
            WITH runs AS (
                SELECT r.id, r.workflow_id, r.status, r.started_at, r.finished_at, r.loop_count, r.gate_rounds
                  FROM workflow_runs r
                 WHERE r.parent_workflow_run_id IS NULL AND ${notTestRun('r.item_id')}
                   AND r.started_at >= ${start}::timestamptz AND r.started_at < ${end}::timestamptz
            ),
            -- Two index probes (the runs themselves, their children by
            -- workflow_runs_parent_idx) instead of an OR that seq-scans.
            tree AS (
                SELECT id AS run_id, id AS root FROM runs
                UNION ALL
                SELECT c.id, c.parent_workflow_run_id FROM workflow_runs c JOIN runs ON c.parent_workflow_run_id = runs.id
            ),
            -- numeric: a float8 SUM depends on row order, which the plan
            -- picks; the decimal sum is the same whatever the plan.
            cost AS (
                SELECT tree.root, SUM(a.total_cost_usd::numeric) AS usd
                  FROM tree
                  JOIN agent_runs a ON a.workflow_run_id = tree.run_id
                 GROUP BY 1
            )
            SELECT runs.workflow_id, w.name,
                   COUNT(*)::text AS runs,
                   COUNT(*) FILTER (WHERE runs.status = 'completed')::text AS completed,
                   COUNT(*) FILTER (WHERE runs.status IN ('completed', 'cancelled', 'error'))::text AS finished,
                   (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM runs.finished_at - runs.started_at))
                        FILTER (WHERE runs.status = 'completed' AND runs.finished_at IS NOT NULL))::text AS median_s,
                   AVG(runs.loop_count)::text AS avg_loops,
                   AVG(runs.gate_rounds)::text AS avg_gate_rounds,
                   SUM(cost.usd)::text AS cost
              FROM runs
              LEFT JOIN workflows w ON w.id = runs.workflow_id
              LEFT JOIN cost ON cost.root = runs.id
             GROUP BY runs.workflow_id, w.name
        `.execute(db),
        // A sub-task that asks parks its own run AND its Task's (`waitOnChild`),
        // and the Owner answered once: the Task's copy (`subtask_waiting`) is
        // skipped and the sub-task's own park, which carries the real kind, is
        // counted. Agent tests are judged by the Task the run tree belongs to.
        sql<{ kind: WorkflowParkKind; n: string }>`
            SELECT ev.park_kind AS kind, COUNT(*)::text AS n
              FROM workflow_run_events ev
              JOIN workflow_runs wr ON wr.id = ev.workflow_run_id
              LEFT JOIN workflow_runs pr ON pr.id = wr.parent_workflow_run_id
              LEFT JOIN items i ON i.id = COALESCE(pr.item_id, wr.item_id)
             WHERE ev.kind = 'parked' AND ev.park_kind <> 'subtask_waiting'
               AND NOT COALESCE(i.is_test, false)
               AND ev.created_at >= ${start}::timestamptz AND ev.created_at < ${end}::timestamptz
             GROUP BY 1 ORDER BY COUNT(*) DESC, 1
        `.execute(db),
        // Red checks by script: the guard-rail's name when it is one, else its id.
        // `runs` counts run trees (a sub-task's run is its Task's run).
        sql<{ script_id: string; name: string; failures: string; runs: string; last_at: unknown }>`
            SELECT g.script_id, COALESCE(s.name, g.script_id) AS name,
                   COUNT(*)::text AS failures,
                   COUNT(DISTINCT COALESCE(r.parent_workflow_run_id, r.id))::text AS runs,
                   MAX(g.created_at) AS last_at
              FROM run_gate_results g
              JOIN workflow_runs r ON r.id = g.workflow_run_id
              LEFT JOIN items i ON i.id = r.item_id
              LEFT JOIN guardrail_scripts s ON s.id = g.script_id
             WHERE g.verdict = 'fail' AND NOT COALESCE(i.is_test, false)
               AND g.created_at >= ${start}::timestamptz AND g.created_at < ${end}::timestamptz
             GROUP BY g.script_id, s.name
             ORDER BY COUNT(*) DESC, 2
             LIMIT 10
        `.execute(db),
        fleetPerformance({ since: start, until: end, exclude_test_items: true }),
    ]);

    const curTally = tally(cur);
    const prevTally = tally(prev);
    const trends = Object.fromEntries(
        Object.entries(METRICS).map(([k, metric]) => [k, trendOf(cur, prev, buckets, metric)]),
    ) as Record<AnalyticsWorkflowsTrendKey, IAnalyticsTrend>;

    const pass = verdicts(cur, 'pass');
    const fail = verdicts(cur, 'fail');
    const retries = retriesOf(cur);
    const tasks = tasksOf(cur);

    return {
        period,
        buckets,
        trends,
        retries_per_task: { retries, tasks, rate: ratio(retries, tasks) },
        gate_failures: gateFailures.rows.map((r) => ({
            script_id: r.script_id,
            name: r.name,
            failures: num(r.failures),
            runs: num(r.runs),
            last_at: iso(r.last_at) ?? '',
        })),
        runs: curTally,
        by_workflow: perWorkflow.rows
            .map((r) => {
                const runs = num(r.runs);
                const cost = numOrNull(r.cost);
                return {
                    workflow_id: r.workflow_id,
                    name: r.name ?? r.workflow_id,
                    runs,
                    completed: num(r.completed),
                    success_rate: ratio(num(r.completed), num(r.finished)),
                    median_duration_s: numOrNull(r.median_s),
                    avg_loops: num(r.avg_loops),
                    avg_gate_rounds: num(r.avg_gate_rounds),
                    cost_per_run_usd: cost === null ? null : cost / runs,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        gates: {
            pass,
            fail,
            unavailable: verdicts(cur, 'unavailable'),
            needs_review: verdicts(cur, 'needs_review'),
            pass_rate: ratio(pass, pass + fail),
        },
        park_reasons: parks.rows.map((r) => ({ kind: r.kind, reason: WORKFLOW_PARK_KIND_LABELS[r.kind], count: num(r.n) })),
        retries: {
            retries,
            dispatches: cur.dispatches.length,
            rate: ratio(retries, cur.dispatches.length),
        },
        // Already in name order (fleetPerformance sorts there, ADR 0023).
        agents: fleet.agents.map((a) => ({
            agent_id: a.agent_id,
            name: a.name,
            accent_color: a.accent_color,
            steps: a.quality.steps,
            first_pass: a.quality.first_pass,
            loops: a.quality.loops,
            gate_catch: a.quality.gate_catch,
            cost_usd: a.cost.total_usd,
            per_step_usd: a.cost.per_step_usd,
            p95_s: a.latency.p95_s,
        })),
        previous: { runs: prevTally.total, success_rate: prevTally.success_rate },
    };
}
