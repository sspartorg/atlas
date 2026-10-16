import { sql } from 'kysely';
import { WORKFLOW_PARK_KIND_LABELS, type AnalyticsWindow, type IAnalyticsWorkflows, type WorkflowParkKind } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { fleetPerformance } from './agent-scorecard.js';
import { resolveWindow } from './analytics-window.js';

// Workflow analytics: how the runs went, per workflow, plus each agent's row.
//
// Runs are top-level `workflow_runs` started in the window (a sub-task's run
// is part of its Task's run, ADR 0015), with agent-test items left out. The
// agent rows are the fleet page's (`shapeAgent`), in name order — a
// comparison, not a leaderboard (ADR 0023) — with agent tests left out too,
// unlike the Fleet performance page.

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export async function workflowAnalytics(opts: {
    tz: string;
    window: AnalyticsWindow;
    now?: Date;
}): Promise<IAnalyticsWorkflows> {
    const period = await resolveWindow(opts.tz, opts.window, opts.now);
    const { start, end, previous_start: pStart, previous_end: pEnd } = period;

    const [statusRows, perWorkflow, gates, parks, retries, fleet] = await Promise.all([
        sql<{ cur: boolean; status: string; n: string }>`
            SELECT r.started_at >= ${start}::timestamptz AS cur, r.status, COUNT(*)::text AS n
              FROM workflow_runs r
              LEFT JOIN items i ON i.id = r.item_id
             WHERE r.parent_workflow_run_id IS NULL AND NOT COALESCE(i.is_test, false)
               AND ((r.started_at >= ${start}::timestamptz AND r.started_at < ${end}::timestamptz)
                 OR (r.started_at >= ${pStart}::timestamptz AND r.started_at < ${pEnd}::timestamptz))
             GROUP BY 1, 2
        `.execute(db),
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
                  LEFT JOIN items i ON i.id = r.item_id
                 WHERE r.parent_workflow_run_id IS NULL AND NOT COALESCE(i.is_test, false)
                   AND r.started_at >= ${start}::timestamptz AND r.started_at < ${end}::timestamptz
            ),
            cost AS (
                SELECT COALESCE(c.parent_workflow_run_id, c.id) AS root, SUM(a.total_cost_usd) AS usd
                  FROM workflow_runs c
                  JOIN agent_runs a ON a.workflow_run_id = c.id
                 WHERE c.id IN (SELECT id FROM runs) OR c.parent_workflow_run_id IN (SELECT id FROM runs)
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
        sql<{ verdict: string; n: string }>`
            SELECT g.verdict, COUNT(*)::text AS n
              FROM run_gate_results g
              JOIN workflow_runs r ON r.id = g.workflow_run_id
              LEFT JOIN items i ON i.id = r.item_id
             WHERE NOT COALESCE(i.is_test, false)
               AND g.created_at >= ${start}::timestamptz AND g.created_at < ${end}::timestamptz
             GROUP BY 1
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
        sql<{ retries: string; dispatches: string }>`
            SELECT COUNT(*) FILTER (WHERE a.parent_run_id IS NOT NULL)::text AS retries,
                   COUNT(*)::text AS dispatches
              FROM agent_runs a
              LEFT JOIN items i ON i.id = a.item_id
             WHERE NOT COALESCE(i.is_test, false)
               AND a.created_at >= ${start}::timestamptz AND a.created_at < ${end}::timestamptz
        `.execute(db),
        fleetPerformance({ since: start, until: end, exclude_test_items: true }),
    ]);

    const tally = (cur: boolean) => {
        const by = new Map<string, number>();
        for (const r of statusRows.rows) if (r.cur === cur) by.set(r.status, num(r.n));
        const get = (s: string) => by.get(s) ?? 0;
        const total = [...by.values()].reduce((a, b) => a + b, 0);
        const finished = get('completed') + get('cancelled') + get('error');
        return {
            total,
            completed: get('completed'),
            cancelled: get('cancelled'),
            error: get('error'),
            waiting_for_owner: get('waiting_for_owner'),
            running: get('running'),
            success_rate: rate(get('completed'), finished),
        };
    };
    const cur = tally(true);
    const prev = tally(false);

    const g = new Map(gates.rows.map((r) => [r.verdict, num(r.n)]));
    const pass = g.get('pass') ?? 0;
    const fail = g.get('fail') ?? 0;
    const rt = retries.rows[0];

    return {
        period,
        runs: cur,
        by_workflow: perWorkflow.rows
            .map((r) => {
                const runs = num(r.runs);
                const cost = numOrNull(r.cost);
                return {
                    workflow_id: r.workflow_id,
                    name: r.name ?? r.workflow_id,
                    runs,
                    completed: num(r.completed),
                    success_rate: rate(num(r.completed), num(r.finished)),
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
            unavailable: g.get('unavailable') ?? 0,
            needs_review: g.get('needs_review') ?? 0,
            pass_rate: rate(pass, pass + fail),
        },
        park_reasons: parks.rows.map((r) => ({ kind: r.kind, reason: WORKFLOW_PARK_KIND_LABELS[r.kind], count: num(r.n) })),
        retries: {
            retries: num(rt?.retries),
            dispatches: num(rt?.dispatches),
            rate: rate(num(rt?.retries), num(rt?.dispatches)),
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
        previous: { runs: prev.total, success_rate: prev.success_rate },
    };
}
