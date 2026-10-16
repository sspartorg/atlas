import { sql } from 'kysely';
import type {
    AnalyticsDeliveryTrendKey,
    AnalyticsWindow,
    IAnalyticsDelivery,
    IAnalyticsSpread,
    IAnalyticsTrend,
    IssuePriority,
    IssueStatus,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { fleetDelivery, percentile, runPrs, scoreAgents, type RunPrs } from './agent-scorecard.js';
import { bucketKey, ratio, resolveWindow, trendOf, windowBuckets } from './analytics-window.js';

// Delivery analytics: how fast work moves, read from the status audit trail.
//
// Every number here comes from `issue_events` rows with `field = 'status'`,
// which every status writer emits (routes, the workflow engine, the Jira
// bridge). Agent-test items (`items.is_test`) are left out throughout: a
// fixture's throwaway Task is not delivery. Events of a deleted item survive
// (no FK) and are dropped by the join to `items`.
//
// Definitions (the web states each one next to its number):
//   shipped         — an item's FIRST move into Done falls in the window
//   lead time       — Task created → first Done
//   cycle time      — Task's first In progress → first Done (none if it never entered In progress before Done)
//   WIP             — Tasks in progress / waiting for info / in review right now
//   flow efficiency — shipped Tasks' time In progress or In review ÷ all their time before Done
//   owner response  — a workflow park → that run's next resume, over parks started in the window
//   rework          — Tasks shipped in the window that left Done again before the window's end
//   first attempt   — Task runs whose every PR merged with no retried agent step and no park in the run tree
//
// Every headline number is computed by one function over a window's facts,
// for this window, the previous one and each bucket (`trendOf`).

const WIP_STATUSES: IssueStatus[] = ['in_progress', 'waiting_for_info', 'in_review'];
const ACTIVE_STATUSES: IssueStatus[] = ['in_progress', 'in_review'];
const STATUS_ORDER: IssueStatus[] = ['draft', 'ready', 'in_progress', 'waiting_for_info', 'in_review'];
const PRIORITY_ORDER: IssuePriority[] = ['urgent', 'high', 'normal', 'low'];
const AGING_AFTER_S = 7 * 86_400;
const H = 3600;
const D = 86_400;
const WEEK_S = 7 * D;
const HISTOGRAM: Array<{ label: string; min_s: number; max_s: number | null }> = [
    { label: '< 1h', min_s: 0, max_s: H },
    { label: '1–4h', min_s: H, max_s: 4 * H },
    { label: '4–24h', min_s: 4 * H, max_s: D },
    { label: '1–3d', min_s: D, max_s: 3 * D },
    { label: '3–7d', min_s: 3 * D, max_s: 7 * D },
    { label: '1–2w', min_s: 7 * D, max_s: 14 * D },
    { label: '> 2w', min_s: 14 * D, max_s: null },
];

/** Linear-interpolated percentile over an ascending list — the same answer as Postgres `percentile_cont`. */
export function percentileCont(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    const a = sorted[lo] ?? 0;
    const b = sorted[hi] ?? 0;
    return a + (b - a) * (i - lo);
}

function spread(values: Array<number | null>): IAnalyticsSpread {
    const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
    return { count: v.length, p50_s: percentileCont(v, 0.5), p90_s: percentileCont(v, 0.9) };
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Each item's first Done (and first In progress before it), for items whose
 * first Done is in [start, end). Shared by this page and the Spend tab's cost
 * per shipped Task, so "shipped" means one thing everywhere.
 *
 * An item whose first Done is in the window has a Done event in the window,
 * so the candidates come from the window's events first (index-only on
 * `idx_issue_events_status_created_at`) and only their history is read
 * (`idx_issue_events_item`), not every status event before `end`. HAVING
 * keeps the answer exact.
 */
function firstDoneIn(start: string, end: string) {
    return sql`
        SELECT e.item_id,
               MIN(e.created_at) FILTER (WHERE e.to_value = 'done') AS done_at,
               MIN(e.created_at) FILTER (WHERE e.to_value = 'in_progress') AS ip_at
          FROM issue_events e
         WHERE e.field = 'status' AND e.created_at < ${end}::timestamptz
           AND e.item_id IN (
               SELECT d.item_id FROM issue_events d
                WHERE d.field = 'status' AND d.to_value = 'done'
                  AND d.created_at >= ${start}::timestamptz AND d.created_at < ${end}::timestamptz
           )
         GROUP BY e.item_id
        HAVING MIN(e.created_at) FILTER (WHERE e.to_value = 'done') >= ${start}::timestamptz
    `;
}

/** Tasks (not sub-tasks) whose first Done falls in [start, end). */
export async function countShippedTasks(start: string, end: string): Promise<number> {
    const r = await sql<{ n: string }>`
        SELECT COUNT(*)::text AS n
          FROM (${firstDoneIn(start, end)}) f
          JOIN items i ON i.id = f.item_id AND NOT i.is_test AND i.type = 'task'
    `.execute(db);
    return num(r.rows[0]?.n);
}

interface ShippedRow {
    item_id: string;
    type: 'task' | 'sub_task';
    priority: IssuePriority | null;
    project_id: string;
    project_name: string | null;
    jira: boolean;
    bucket: string;
    /** Monday of the Done's week, whatever the window's bucket. */
    week: string;
    lead_s: string | null;
    cycle_s: string | null;
    /** Left Done again after its first Done, before the window's end. */
    reworked: boolean;
}

async function shippedRows(start: string, end: string, tz: string, unit: 'day' | 'week'): Promise<ShippedRow[]> {
    const r = await sql<ShippedRow>`
        SELECT f.item_id, i.type, i.priority, i.project_id, p.name AS project_name,
               EXISTS (SELECT 1 FROM item_external_links l
                        WHERE l.item_id = i.id AND l.link_kind = 'jira_issue') AS jira,
               to_char(date_trunc(${unit}, f.done_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
               to_char(date_trunc('week', f.done_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS week,
               EXTRACT(EPOCH FROM f.done_at - i.created_at) AS lead_s,
               CASE WHEN f.ip_at <= f.done_at THEN EXTRACT(EPOCH FROM f.done_at - f.ip_at) END AS cycle_s,
               EXISTS (SELECT 1 FROM issue_events r
                        WHERE r.item_id = i.id AND r.field = 'status' AND r.from_value = 'done'
                          AND r.created_at > f.done_at AND r.created_at < ${end}::timestamptz) AS reworked
          FROM (${firstDoneIn(start, end)}) f
          JOIN items i ON i.id = f.item_id AND NOT i.is_test
          LEFT JOIN projects p ON p.id = i.project_id
    `.execute(db);
    return r.rows;
}

/** Shipped Tasks in [start, end), bucketed: the Spend tab's cost per shipped Task per bucket. */
export async function shippedTaskBuckets(
    start: string,
    end: string,
    tz: string,
    unit: 'day' | 'week',
): Promise<Array<{ bucket: string; item_id: string }>> {
    return (await shippedRows(start, end, tz, unit))
        .filter((r) => r.type === 'task')
        .map((r) => ({ bucket: r.bucket, item_id: r.item_id }));
}

/** What one window's numbers are computed from. Every list carries its bucket. */
type Facts = {
    shipped: ShippedRow[];
    /** Time each shipped Task spent in each status before its first Done. */
    status: Array<{ bucket: string; item_id: string; status: IssueStatus; total_s: number }>;
    /** Moves into Waiting for info that started in the window; an open one runs to the window's end. */
    waits: Array<{ bucket: string; s: number; open: boolean }>;
    /** Status moves in the window into or out of Done. */
    moves: Array<{ bucket: string; item_id: string; reopen: boolean; done: boolean }>;
    /** Workflow parks started in the window; `response_s` null while unanswered at the window's end. */
    parks: Array<{ bucket: string; response_s: number | null }>;
    /** Top-level runs started in the window, with their PRs. */
    runs: Array<RunPrs & { bucket: string; clean: boolean }>;
};

/** Root runs whose tree retried an agent step or parked: not a first-attempt merge. */
async function reworkedRunTrees(rootIds: string[]): Promise<Set<string>> {
    if (rootIds.length === 0) return new Set();
    const ids = sql.join(rootIds);
    const r = await sql<{ root: string }>`
        WITH t AS (
            SELECT id AS run_id, id AS root FROM workflow_runs WHERE id IN (${ids})
            UNION ALL
            SELECT id, parent_workflow_run_id FROM workflow_runs WHERE parent_workflow_run_id IN (${ids})
        )
        SELECT DISTINCT t.root FROM t
         WHERE EXISTS (SELECT 1 FROM agent_runs a WHERE a.workflow_run_id = t.run_id AND a.parent_run_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM workflow_run_events ev WHERE ev.workflow_run_id = t.run_id AND ev.kind = 'parked')
    `.execute(db);
    return new Set(r.rows.map((x) => x.root));
}

async function windowFacts(start: string, end: string, tz: string, unit: 'day' | 'week', perRun: RunPrs[]): Promise<Facts> {
    const [shipped, status, waits, moves, parks] = await Promise.all([
        shippedRows(start, end, tz, unit),
        // Time in each status before a shipped Task's first Done. LEAD pairs
        // each status event with the next one; the item's creation opens the
        // first interval in the first event's `from_value`.
        sql<{ item_id: string; status: IssueStatus; total_s: string }>`
            WITH s AS (
                SELECT f.item_id, f.done_at
                  FROM (${firstDoneIn(start, end)}) f
                  JOIN items i ON i.id = f.item_id AND NOT i.is_test AND i.type = 'task'
            ),
            ev AS (
                SELECT e.item_id, e.from_value, e.to_value, e.created_at,
                       LEAD(e.created_at) OVER w AS next_at,
                       ROW_NUMBER() OVER w AS rn
                  FROM issue_events e
                  JOIN s ON s.item_id = e.item_id
                 WHERE e.field = 'status' AND e.created_at <= s.done_at
                WINDOW w AS (PARTITION BY e.item_id ORDER BY e.created_at, e.id)
            ),
            iv AS (
                SELECT item_id, to_value AS status, created_at AS from_at, next_at AS to_at
                  FROM ev WHERE to_value <> 'done'
                UNION ALL
                SELECT ev.item_id, ev.from_value, i.created_at, ev.created_at
                  FROM ev JOIN items i ON i.id = ev.item_id
                 WHERE ev.rn = 1 AND ev.from_value IS NOT NULL
            )
            SELECT item_id, status, SUM(EXTRACT(EPOCH FROM to_at - from_at))::text AS total_s
              FROM iv
             WHERE to_at IS NOT NULL AND to_at > from_at
             GROUP BY item_id, status
        `.execute(db),
        // A wait's next event is never earlier than the wait itself, so the
        // window's lower bound leaves LEAD unchanged.
        sql<{ bucket: string; s: string; open: boolean }>`
            WITH ev AS (
                SELECT e.to_value, e.created_at,
                       LEAD(e.created_at) OVER (PARTITION BY e.item_id ORDER BY e.created_at, e.id) AS next_at
                  FROM issue_events e
                  JOIN items i ON i.id = e.item_id AND NOT i.is_test
                 WHERE e.field = 'status'
                   AND e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
            )
            SELECT to_char(date_trunc(${unit}, created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
                   EXTRACT(EPOCH FROM COALESCE(next_at, ${end}::timestamptz) - created_at)::text AS s,
                   next_at IS NULL AS open
              FROM ev
             WHERE to_value = 'waiting_for_info'
        `.execute(db),
        sql<{ bucket: string; item_id: string; reopen: boolean; done: boolean }>`
            SELECT to_char(date_trunc(${unit}, e.created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
                   e.item_id, e.from_value = 'done' AS reopen, e.to_value = 'done' AS done
              FROM issue_events e
              JOIN items i ON i.id = e.item_id AND NOT i.is_test
             WHERE e.field = 'status' AND (e.from_value = 'done' OR e.to_value = 'done')
               AND e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
        `.execute(db),
        // As on the Workflows tab: a sub-task that asks parks its Task's run
        // too (subtask_waiting); the Owner answered once, so that copy is
        // skipped. Agent tests are judged by the Task the run tree belongs to.
        sql<{ bucket: string; response_s: string | null }>`
            SELECT to_char(date_trunc(${unit}, ev.created_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
                   EXTRACT(EPOCH FROM (
                       SELECT MIN(r.created_at) FROM workflow_run_events r
                        WHERE r.workflow_run_id = ev.workflow_run_id AND r.kind = 'resumed'
                          AND r.created_at >= ev.created_at AND r.created_at < ${end}::timestamptz
                   ) - ev.created_at)::text AS response_s
              FROM workflow_run_events ev
              JOIN workflow_runs wr ON wr.id = ev.workflow_run_id
              LEFT JOIN workflow_runs pr ON pr.id = wr.parent_workflow_run_id
              LEFT JOIN items i ON i.id = COALESCE(pr.item_id, wr.item_id)
             WHERE ev.kind = 'parked' AND ev.park_kind <> 'subtask_waiting'
               AND NOT COALESCE(i.is_test, false)
               AND ev.created_at >= ${start}::timestamptz AND ev.created_at < ${end}::timestamptz
        `.execute(db),
    ]);

    const bucketOfItem = new Map(shipped.map((r) => [r.item_id, r.bucket]));
    const merged = perRun.filter((r) => r.opened > 0 && r.merged === r.opened).map((r) => r.run_id);
    const dirty = await reworkedRunTrees(merged);

    return {
        shipped,
        status: status.rows.map((r) => ({
            bucket: bucketOfItem.get(r.item_id) ?? '',
            item_id: r.item_id,
            status: r.status,
            total_s: Number(r.total_s),
        })),
        waits: waits.rows.map((r) => ({ bucket: r.bucket, s: Number(r.s), open: r.open })),
        moves: moves.rows,
        parks: parks.rows.map((r) => ({ bucket: r.bucket, response_s: numOrNull(r.response_s) })),
        runs: perRun.map((r) => ({
            ...r,
            bucket: r.started_at ? bucketKey(r.started_at, tz, unit) : '',
            clean: !dirty.has(r.run_id),
        })),
    };
}

const tasksOf = (f: Facts) => f.shipped.filter((r) => r.type === 'task');
const mergedRuns = (f: Facts) => f.runs.filter((r) => r.opened > 0 && r.merged === r.opened);
const answered = (f: Facts) =>
    f.parks
        .map((p) => p.response_s)
        .filter((s): s is number => s !== null)
        .sort((a, b) => a - b);
const flowTotals = (f: Facts) => {
    const active = sum(f.status.filter((s) => ACTIVE_STATUSES.includes(s.status)).map((s) => s.total_s));
    const all = sum(f.status.map((s) => s.total_s));
    return { active, waiting: all - active };
};

/** The metrics with one definition per window; WIP and weekly throughput are not per-bucket sums and are built separately. */
const METRICS: Record<Exclude<AnalyticsDeliveryTrendKey, 'wip' | 'weekly_throughput'>, (f: Facts) => number | null> = {
    tasks_shipped: (f) => tasksOf(f).length,
    lead_p50_s: (f) => spread(tasksOf(f).map((r) => numOrNull(r.lead_s))).p50_s,
    cycle_p50_s: (f) => spread(tasksOf(f).map((r) => numOrNull(r.cycle_s))).p50_s,
    waiting_s: (f) => (f.waits.length === 0 ? null : sum(f.waits.map((w) => w.s))),
    reopen_rate: (f) =>
        ratio(
            new Set(f.moves.filter((m) => m.reopen).map((m) => m.item_id)).size,
            new Set(f.moves.filter((m) => m.done).map((m) => m.item_id)).size,
        ),
    prs_merged: (f) => sum(f.runs.map((r) => r.merged)),
    time_to_pr_s: (f) =>
        percentile(
            f.runs
                .map((r) => r.s_to_pr)
                .filter((s): s is number => s !== null)
                .sort((a, b) => a - b),
            0.5,
        ),
    flow_efficiency: (f) => {
        const t = flowTotals(f);
        return ratio(t.active, t.active + t.waiting);
    },
    owner_response_p50_s: (f) => percentileCont(answered(f), 0.5),
    rework_rate: (f) => ratio(tasksOf(f).filter((r) => r.reworked).length, tasksOf(f).length),
    first_attempt_merge_rate: (f) => {
        const m = mergedRuns(f);
        return ratio(m.filter((r) => r.clean).length, m.length);
    },
};

/**
 * Tasks in progress, waiting or in review at the end of each bucket (and at
 * the end of the previous window), replayed from the status history.
 */
async function wipHistory(
    start: string,
    end: string,
    prevEnd: string,
    tz: string,
    unit: 'day' | 'week',
): Promise<Map<string, number>> {
    const r = await sql<{ bucket: string; n: string }>`
        WITH ends AS (
            SELECT to_char(d, 'YYYY-MM-DD') AS bucket,
                   LEAST((d + ('1 ' || ${unit})::interval) AT TIME ZONE ${tz}, ${end}::timestamptz) AS at
              FROM generate_series(
                       date_trunc(${unit}, ${start}::timestamptz AT TIME ZONE ${tz}),
                       ${end}::timestamptz AT TIME ZONE ${tz},
                       ('1 ' || ${unit})::interval) d
            UNION ALL
            SELECT 'previous', ${prevEnd}::timestamptz
        ),
        iv AS (
            SELECT e.to_value, e.created_at AS f,
                   LEAD(e.created_at) OVER (PARTITION BY e.item_id ORDER BY e.created_at, e.id) AS t
              FROM issue_events e
              JOIN items i ON i.id = e.item_id AND NOT i.is_test AND i.type = 'task'
             WHERE e.field = 'status' AND e.created_at < ${end}::timestamptz
        )
        SELECT ends.bucket, COUNT(iv.f)::text AS n
          FROM ends
          LEFT JOIN iv ON iv.f <= ends.at AND (iv.t IS NULL OR iv.t > ends.at)
                      AND iv.to_value IN (${sql.join(WIP_STATUSES)})
         GROUP BY ends.bucket
    `.execute(db);
    return new Map(r.rows.map((x) => [x.bucket, Number(x.n)]));
}

const spanS = (start: string, end: string) => (new Date(end).getTime() - new Date(start).getTime()) / 1000;

export async function deliveryAnalytics(opts: {
    tz: string;
    window: AnalyticsWindow;
    now?: Date;
}): Promise<IAnalyticsDelivery> {
    const period = await resolveWindow(opts.tz, opts.window, opts.now);
    const { tz, start, end, previous_start: pStart, previous_end: pEnd, bucket: unit } = period;

    const [cards, buckets, wip, wipAt] = await Promise.all([
        Promise.all([scoreAgents({ since: start, until: end }), scoreAgents({ since: pStart, until: pEnd })]),
        windowBuckets(period),
        // A WIP Task's age runs from its first In progress since it last left
        // Done, so a reopened Task is not aged by its first life.
        sql<{ id: string; title: string; status: IssueStatus; project_id: string; age_s: string }>`
            SELECT i.id, i.title, i.status, i.project_id,
                   EXTRACT(EPOCH FROM ${end}::timestamptz - COALESCE(st.started, i.started_at, i.created_at)) AS age_s
              FROM items i
              LEFT JOIN LATERAL (
                  SELECT MAX(e.created_at) AS reopened_at FROM issue_events e
                   WHERE e.item_id = i.id AND e.field = 'status' AND e.from_value = 'done'
              ) r ON true
              LEFT JOIN LATERAL (
                  SELECT MIN(e.created_at) AS started FROM issue_events e
                   WHERE e.item_id = i.id AND e.field = 'status' AND e.to_value = 'in_progress'
                     AND e.created_at >= COALESCE(r.reopened_at, '-infinity'::timestamptz)
              ) st ON true
             WHERE NOT i.is_test AND i.type = 'task'
               AND i.status IN (${sql.join(WIP_STATUSES)})
             ORDER BY age_s DESC, i.id
        `.execute(db),
        wipHistory(start, end, pEnd, tz, unit),
    ]);
    const [card, prevCard] = cards;
    const [perRun, prevPerRun] = await Promise.all([runPrs(card), runPrs(prevCard)]);
    const [cur, prev, prs, prevPrs] = await Promise.all([
        windowFacts(start, end, tz, unit, perRun),
        windowFacts(pStart, pEnd, tz, unit, prevPerRun),
        fleetDelivery(card, perRun),
        fleetDelivery(prevCard, prevPerRun),
    ]);

    const rows = cur.shipped;
    const prevRows = prev.shipped;
    const tasks = tasksOf(cur);
    const cycle = spread(tasks.map((r) => numOrNull(r.cycle_s)));

    const perBucket = new Map<string, { tasks: number; sub_tasks: number; cycles: number[] }>();
    for (const b of buckets) perBucket.set(b, { tasks: 0, sub_tasks: 0, cycles: [] });
    for (const r of rows) {
        const b = perBucket.get(r.bucket);
        if (!b) continue;
        if (r.type === 'task') {
            b.tasks += 1;
            if (r.cycle_s !== null) b.cycles.push(Number(r.cycle_s));
        } else b.sub_tasks += 1;
    }

    const cycleValues = tasks.map((r) => numOrNull(r.cycle_s)).filter((v): v is number => v !== null);

    const byProject = new Map<string, { name: string; rows: ShippedRow[] }>();
    for (const r of tasks) {
        const e = byProject.get(r.project_id) ?? { name: r.project_name ?? r.project_id, rows: [] };
        e.rows.push(r);
        byProject.set(r.project_id, e);
    }

    const reopened = new Set(cur.moves.filter((m) => m.reopen).map((m) => m.item_id)).size;
    const doneN = new Set(cur.moves.filter((m) => m.done).map((m) => m.item_id)).size;

    // Tasks shipped per Monday week across the window; the tile is their mean per week of window.
    const weeks = [...new Set(buckets.map((b) => bucketKey(`${b}T12:00:00Z`, 'UTC', 'week')))];
    const perWeek = new Map(weeks.map((w) => [w, 0]));
    for (const r of tasks) if (perWeek.has(r.week)) perWeek.set(r.week, (perWeek.get(r.week) ?? 0) + 1);
    const weeklyOf = (n: number, from: string, to: string) => ratio(n * WEEK_S, spanS(from, to));

    const trends = Object.fromEntries(
        Object.entries(METRICS).map(([k, metric]) => [k, trendOf(cur, prev, buckets, metric)]),
    ) as Record<AnalyticsDeliveryTrendKey, IAnalyticsTrend>;
    trends.wip = {
        cur: wip.rows.length,
        prev: wipAt.get('previous') ?? 0,
        series: buckets.map((b) => wipAt.get(b) ?? 0),
    };
    trends.weekly_throughput = {
        cur: weeklyOf(tasks.length, start, end),
        prev: weeklyOf(tasksOf(prev).length, pStart, pEnd),
        series: buckets.map((b) => perWeek.get(bucketKey(`${b}T12:00:00Z`, 'UTC', 'week')) ?? 0),
    };

    const flow = flowTotals(cur);
    const replies = answered(cur);
    const merged = mergedRuns(cur);

    return {
        period,
        buckets,
        trends,
        flow: {
            efficiency: ratio(flow.active, flow.active + flow.waiting),
            active_s: flow.active,
            waiting_s: flow.waiting,
            owner_response: {
                answered: replies.length,
                unanswered: cur.parks.length - replies.length,
                p50_s: percentileCont(replies, 0.5),
                p90_s: percentileCont(replies, 0.9),
            },
            weekly_throughput: trends.weekly_throughput.cur,
            weekly: weeks.map((bucket) => ({ bucket, tasks: perWeek.get(bucket) ?? 0 })),
        },
        rework: {
            shipped: tasks.length,
            reopened: tasks.filter((r) => r.reworked).length,
            rate: ratio(tasks.filter((r) => r.reworked).length, tasks.length),
        },
        first_attempt: {
            merged_runs: merged.length,
            clean: merged.filter((r) => r.clean).length,
            rate: ratio(merged.filter((r) => r.clean).length, merged.length),
        },
        shipped: { tasks: tasks.length, sub_tasks: rows.length - tasks.length },
        throughput: [...perBucket.entries()].map(([key, b]) => ({
            bucket: key,
            tasks: b.tasks,
            sub_tasks: b.sub_tasks,
            cycle_p50_s: percentileCont(b.cycles.sort((x, y) => x - y), 0.5),
        })),
        lead_time: spread(tasks.map((r) => numOrNull(r.lead_s))),
        cycle_time: cycle,
        cycle_histogram: HISTOGRAM.map((h) => ({
            ...h,
            count: cycleValues.filter((v) => v >= h.min_s && (h.max_s === null || v < h.max_s)).length,
        })),
        time_in_status: STATUS_ORDER.map((status) => {
            const mine = cur.status.filter((s) => s.status === status);
            return {
                status,
                avg_s: tasks.length === 0 ? 0 : sum(mine.map((s) => s.total_s)) / tasks.length,
                items: mine.length,
            };
        }),
        waiting: {
            parks: cur.waits.length,
            total_s: sum(cur.waits.map((w) => w.s)),
            median_s: percentileCont(
                cur.waits.map((w) => w.s).sort((a, b) => a - b),
                0.5,
            ),
            still_waiting: cur.waits.filter((w) => w.open).length,
        },
        reopens: { reopened, done: doneN, rate: ratio(reopened, doneN) },
        wip: {
            count: wip.rows.length,
            aging: wip.rows.filter((r) => Number(r.age_s) > AGING_AFTER_S).length,
            aging_after_s: AGING_AFTER_S,
            oldest: wip.rows.slice(0, 10).map((r) => ({ ...r, age_s: Number(r.age_s) })),
        },
        by_priority: PRIORITY_ORDER.map((priority) => {
            const mine = tasks.filter((r) => r.priority === priority);
            return { priority, shipped: mine.length, cycle_p50_s: spread(mine.map((r) => numOrNull(r.cycle_s))).p50_s };
        }),
        by_project: [...byProject.entries()]
            .map(([project_id, e]) => ({
                project_id,
                project_name: e.name,
                shipped: e.rows.length,
                cycle_p50_s: spread(e.rows.map((r) => numOrNull(r.cycle_s))).p50_s,
                lead_p50_s: spread(e.rows.map((r) => numOrNull(r.lead_s))).p50_s,
            }))
            .sort((a, b) => b.shipped - a.shipped || a.project_name.localeCompare(b.project_name)),
        source_mix: { jira: tasks.filter((r) => r.jira).length, native: tasks.filter((r) => !r.jira).length },
        prs: {
            opened: prs.prs_opened,
            merged: prs.prs_merged,
            merge_rate: prs.merge_rate,
            median_s_to_pr: prs.median_s_to_pr,
        },
        previous: {
            tasks_shipped: prevRows.filter((r) => r.type === 'task').length,
            cycle_p50_s: spread(prevRows.filter((r) => r.type === 'task').map((r) => numOrNull(r.cycle_s))).p50_s,
            prs_merged: prevPrs.prs_merged,
        },
    };
}
