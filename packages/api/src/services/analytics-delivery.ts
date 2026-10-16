import { sql } from 'kysely';
import type {
    AnalyticsWindow,
    IAnalyticsDelivery,
    IAnalyticsSpread,
    IssuePriority,
    IssueStatus,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { fleetDelivery, scoreAgents } from './agent-scorecard.js';
import { resolveWindow } from './analytics-window.js';

// Delivery analytics: how fast work moves, read from the status audit trail.
//
// Every number here comes from `issue_events` rows with `field = 'status'`,
// which every status writer emits (routes, the workflow engine, the Jira
// bridge). Agent-test items (`items.is_test`) are left out throughout: a
// fixture's throwaway Task is not delivery. Events of a deleted item survive
// (no FK) and are dropped by the join to `items`.
//
// Definitions (the web states each one next to its number):
//   shipped     — an item's FIRST move into Done falls in the window
//   lead time   — Task created → first Done
//   cycle time  — Task's first In progress → first Done (none if it never entered In progress before Done)
//   WIP         — Tasks in progress / waiting for info / in review right now

const WIP_STATUSES: IssueStatus[] = ['in_progress', 'waiting_for_info', 'in_review'];
const STATUS_ORDER: IssueStatus[] = ['draft', 'ready', 'in_progress', 'waiting_for_info', 'in_review'];
const PRIORITY_ORDER: IssuePriority[] = ['urgent', 'high', 'normal', 'low'];
const AGING_AFTER_S = 7 * 86_400;
const H = 3600;
const D = 86_400;
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

/**
 * Each item's first Done (and first In progress before it), for items whose
 * first Done is in [start, end). Shared by this page and the Spend tab's cost
 * per shipped Task, so "shipped" means one thing everywhere.
 */
function firstDoneIn(start: string, end: string) {
    return sql`
        SELECT e.item_id,
               MIN(e.created_at) FILTER (WHERE e.to_value = 'done') AS done_at,
               MIN(e.created_at) FILTER (WHERE e.to_value = 'in_progress') AS ip_at
          FROM issue_events e
         WHERE e.field = 'status' AND e.created_at < ${end}::timestamptz
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
    lead_s: string | null;
    cycle_s: string | null;
}

async function shippedRows(start: string, end: string, tz: string, unit: 'day' | 'week'): Promise<ShippedRow[]> {
    const r = await sql<ShippedRow>`
        SELECT f.item_id, i.type, i.priority, i.project_id, p.name AS project_name,
               EXISTS (SELECT 1 FROM item_external_links l
                        WHERE l.item_id = i.id AND l.link_kind = 'jira_issue') AS jira,
               to_char(date_trunc(${unit}, f.done_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket,
               EXTRACT(EPOCH FROM f.done_at - i.created_at) AS lead_s,
               CASE WHEN f.ip_at <= f.done_at THEN EXTRACT(EPOCH FROM f.done_at - f.ip_at) END AS cycle_s
          FROM (${firstDoneIn(start, end)}) f
          JOIN items i ON i.id = f.item_id AND NOT i.is_test
          LEFT JOIN projects p ON p.id = i.project_id
    `.execute(db);
    return r.rows;
}

export async function deliveryAnalytics(opts: {
    tz: string;
    window: AnalyticsWindow;
    now?: Date;
}): Promise<IAnalyticsDelivery> {
    const period = await resolveWindow(opts.tz, opts.window, opts.now);
    const { tz, start, end, previous_start: pStart, previous_end: pEnd, bucket: unit } = period;

    const [rows, prevRows, buckets, inStatus, waits, reopens, wip, prs, prevPrs] = await Promise.all([
        shippedRows(start, end, tz, unit),
        shippedRows(pStart, pEnd, tz, unit),
        // Zero-filled bucket keys, so a quiet day reads as zero rather than a gap.
        sql<{ bucket: string }>`
            SELECT to_char(d, 'YYYY-MM-DD') AS bucket
              FROM generate_series(
                       date_trunc(${unit}, ${start}::timestamptz AT TIME ZONE ${tz}),
                       ${end}::timestamptz AT TIME ZONE ${tz},
                       ('1 ' || ${unit})::interval) d
        `.execute(db),
        // Time in each status before a shipped Task's first Done. LEAD pairs
        // each status event with the next one; the item's creation opens the
        // first interval in the first event's `from_value`.
        sql<{ status: IssueStatus; total_s: string; items: string }>`
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
            SELECT status, SUM(EXTRACT(EPOCH FROM to_at - from_at))::text AS total_s,
                   COUNT(DISTINCT item_id)::text AS items
              FROM iv
             WHERE to_at IS NOT NULL AND to_at > from_at
             GROUP BY status
        `.execute(db),
        // Every move into Waiting for info that started in the window; one
        // still open is measured to the window's end.
        sql<{ parks: string; total_s: string | null; median_s: string | null; still_waiting: string }>`
            WITH ev AS (
                SELECT e.to_value, e.created_at,
                       LEAD(e.created_at) OVER (PARTITION BY e.item_id ORDER BY e.created_at, e.id) AS next_at
                  FROM issue_events e
                  JOIN items i ON i.id = e.item_id AND NOT i.is_test
                 WHERE e.field = 'status' AND e.created_at < ${end}::timestamptz
            ),
            w AS (
                SELECT EXTRACT(EPOCH FROM COALESCE(next_at, ${end}::timestamptz) - created_at) AS s,
                       next_at IS NULL AS open
                  FROM ev
                 WHERE to_value = 'waiting_for_info' AND created_at >= ${start}::timestamptz
            )
            SELECT COUNT(*)::text AS parks, SUM(s)::text AS total_s,
                   (percentile_cont(0.5) WITHIN GROUP (ORDER BY s))::text AS median_s,
                   COUNT(*) FILTER (WHERE open)::text AS still_waiting
              FROM w
        `.execute(db),
        sql<{ reopened: string; done: string }>`
            SELECT COUNT(DISTINCT e.item_id) FILTER (WHERE e.from_value = 'done')::text AS reopened,
                   COUNT(DISTINCT e.item_id) FILTER (WHERE e.to_value = 'done')::text AS done
              FROM issue_events e
              JOIN items i ON i.id = e.item_id AND NOT i.is_test
             WHERE e.field = 'status'
               AND e.created_at >= ${start}::timestamptz AND e.created_at < ${end}::timestamptz
        `.execute(db),
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
        scoreAgents({ since: start, until: end }).then(fleetDelivery),
        scoreAgents({ since: pStart, until: pEnd }).then(fleetDelivery),
    ]);

    const tasks = rows.filter((r) => r.type === 'task');
    const cycle = spread(tasks.map((r) => numOrNull(r.cycle_s)));

    const perBucket = new Map<string, { tasks: number; sub_tasks: number; cycles: number[] }>();
    for (const b of buckets.rows) perBucket.set(b.bucket, { tasks: 0, sub_tasks: 0, cycles: [] });
    for (const r of rows) {
        const b = perBucket.get(r.bucket);
        if (!b) continue;
        if (r.type === 'task') {
            b.tasks += 1;
            if (r.cycle_s !== null) b.cycles.push(Number(r.cycle_s));
        } else b.sub_tasks += 1;
    }

    const cycleValues = tasks.map((r) => numOrNull(r.cycle_s)).filter((v): v is number => v !== null);
    const statusTotals = new Map(inStatus.rows.map((r) => [r.status, r]));

    const byProject = new Map<string, { name: string; rows: ShippedRow[] }>();
    for (const r of tasks) {
        const e = byProject.get(r.project_id) ?? { name: r.project_name ?? r.project_id, rows: [] };
        e.rows.push(r);
        byProject.set(r.project_id, e);
    }

    const w = waits.rows[0];
    const ro = reopens.rows[0];
    const reopened = num(ro?.reopened);
    const doneN = num(ro?.done);

    return {
        period,
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
            const t = statusTotals.get(status);
            return {
                status,
                avg_s: tasks.length === 0 ? 0 : num(t?.total_s) / tasks.length,
                items: num(t?.items),
            };
        }),
        waiting: {
            parks: num(w?.parks),
            total_s: num(w?.total_s),
            median_s: numOrNull(w?.median_s),
            still_waiting: num(w?.still_waiting),
        },
        reopens: { reopened, done: doneN, rate: doneN === 0 ? null : reopened / doneN },
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
