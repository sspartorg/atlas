import { sql } from 'kysely';
import type {
    AnalyticsSpendTrendKey,
    IAnalyticsCostEfficiencyRow,
    IAnalyticsPeriod,
    IAnalyticsSpendInsight,
    IAnalyticsTrend,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { shippedTaskBuckets } from './analytics-delivery.js';
import { notTestRun, ratio, trendOf, windowBuckets } from './analytics-window.js';
import { lookupClaudePrices } from './claude-model-pricing.js';

// The Spend tab's trends and cost efficiency. The rest of `GET /api/analytics`
// (summary, daily, by agent / project / model, top runs) stays in the route.
//
// Definitions (stated next to each number on the page):
//   spend            — completed agent runs + closed terminal sessions in the window (agent tests left out)
//   cost per Task    — that spend ÷ Tasks first moved into Done in the window
//   cache savings    — cached tokens × (fresh-input price − cache-read price), per model; unpriced models left out
//   cache hit rate   — agent runs' cache reads ÷ (cache reads + fresh input)
//   cost efficiency  — workflow runs started in the window, every step of each run tree: cost ÷ PRs they
//                      opened, and ÷ their Tasks that shipped in the window; by workflow and by model

/** Cache reads cost a fraction of fresh input; the saving is the difference, priced per model. */
export function cacheSavings(rows: Array<{ model: string | null; cache_read_tokens: number }>) {
    let usd = 0;
    let unpriced = 0;
    for (const r of rows) {
        const p = r.model ? lookupClaudePrices(r.model) : null;
        if (p) usd += (r.cache_read_tokens * (p.input - p.cache_read)) / 1_000_000;
        else unpriced += r.cache_read_tokens;
    }
    return { usd, unpriced };
}

type Facts = {
    agent: Array<{ bucket: string; model: string | null; cost: number; input_tokens: number; cache_read_tokens: number }>;
    terminal: Array<{ bucket: string; model: string | null; cost: number; cache_read_tokens: number }>;
    shipped: Array<{ bucket: string; item_id: string }>;
};

async function windowFacts(start: string, end: string, tz: string, unit: 'day' | 'week'): Promise<Facts> {
    const [agent, terminal, shipped] = await Promise.all([
        sql<{ bucket: string; model: string | null; cost: string | null; input_tokens: string | null; cache_read_tokens: string | null }>`
            SELECT to_char(date_trunc(${unit}, completed_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket, model,
                   SUM(total_cost_usd)::text AS cost, SUM(input_tokens)::text AS input_tokens,
                   SUM(cache_read_tokens)::text AS cache_read_tokens
              FROM agent_runs
             WHERE status = 'completed' AND ${notTestRun('agent_runs.item_id')}
               AND completed_at >= ${start}::timestamptz AND completed_at < ${end}::timestamptz
             GROUP BY 1, 2
        `.execute(db),
        sql<{ bucket: string; model: string | null; cost: string | null; cache_read_tokens: string | null }>`
            SELECT to_char(date_trunc(${unit}, closed_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS bucket, model,
                   SUM(total_cost_usd)::text AS cost, SUM(cache_read_tokens)::text AS cache_read_tokens
              FROM cli_sessions
             WHERE status = 'closed' AND closed_at >= ${start}::timestamptz AND closed_at < ${end}::timestamptz
             GROUP BY 1, 2
        `.execute(db),
        shippedTaskBuckets(start, end, tz, unit),
    ]);
    const n = (v: string | null) => Number(v ?? 0);
    return {
        agent: agent.rows.map((r) => ({
            bucket: r.bucket,
            model: r.model,
            cost: n(r.cost),
            input_tokens: n(r.input_tokens),
            cache_read_tokens: n(r.cache_read_tokens),
        })),
        terminal: terminal.rows.map((r) => ({ bucket: r.bucket, model: r.model, cost: n(r.cost), cache_read_tokens: n(r.cache_read_tokens) })),
        shipped,
    };
}

const spendOf = (f: Facts) => f.agent.reduce((a, r) => a + r.cost, 0) + f.terminal.reduce((a, r) => a + r.cost, 0);

const METRICS: Record<AnalyticsSpendTrendKey, (f: Facts) => number | null> = {
    spend: spendOf,
    cost_per_task: (f) => ratio(spendOf(f), f.shipped.length),
    cache_savings: (f) => cacheSavings([...f.agent, ...f.terminal]).usd,
    cache_hit_rate: (f) => {
        const cached = f.agent.reduce((a, r) => a + r.cache_read_tokens, 0);
        return ratio(cached, cached + f.agent.reduce((a, r) => a + r.input_tokens, 0));
    },
};

interface TreeRow {
    run_id: string;
    workflow_id: string;
    workflow_name: string | null;
    item_id: string | null;
    prs: number;
    model: string | null;
    cli: string | null;
    usd: string | null;
}

function row(runs: Set<string>, cost: number, prs: number, shipped: number): IAnalyticsCostEfficiencyRow {
    return { runs: runs.size, cost_usd: cost, prs, shipped_tasks: shipped, per_pr_usd: ratio(cost, prs), per_task_usd: ratio(cost, shipped) };
}

async function costEfficiency(start: string, end: string, shippedIds: Set<string>): Promise<IAnalyticsSpendInsight['cost_efficiency']> {
    // One row per (run tree, model): the tree's PR count rides along on each.
    // A run with no agent step still counts as a run of its workflow.
    const r = await sql<TreeRow>`
        WITH runs AS (
            SELECT r.id, r.workflow_id, r.item_id,
                   CASE WHEN jsonb_typeof(r.pr_urls) = 'array' AND jsonb_array_length(r.pr_urls) > 0
                        THEN jsonb_array_length(r.pr_urls)
                        WHEN r.pr_url IS NOT NULL THEN 1 ELSE 0 END AS prs
              FROM workflow_runs r
             WHERE r.parent_workflow_run_id IS NULL AND ${notTestRun('r.item_id')}
               AND r.started_at >= ${start}::timestamptz AND r.started_at < ${end}::timestamptz
        ),
        tree AS (
            SELECT id AS run_id, id AS root FROM runs
            UNION ALL
            SELECT c.id, c.parent_workflow_run_id FROM workflow_runs c JOIN runs ON c.parent_workflow_run_id = runs.id
        ),
        steps AS (
            SELECT tree.root, a.model, a.cli, SUM(a.total_cost_usd::numeric) AS usd
              FROM tree JOIN agent_runs a ON a.workflow_run_id = tree.run_id
             GROUP BY 1, 2, 3
        )
        SELECT runs.id AS run_id, runs.workflow_id, w.name AS workflow_name, runs.item_id, runs.prs,
               steps.model, steps.cli, steps.usd::text AS usd
          FROM runs
          LEFT JOIN workflows w ON w.id = runs.workflow_id
          LEFT JOIN steps ON steps.root = runs.id
    `.execute(db);

    const prsOf = new Map<string, number>();
    const itemOf = new Map<string, string | null>();
    for (const x of r.rows) {
        prsOf.set(x.run_id, Number(x.prs));
        itemOf.set(x.run_id, x.item_id);
    }
    const totals = (runIds: Set<string>) => ({
        prs: [...runIds].reduce((a, id) => a + (prsOf.get(id) ?? 0), 0),
        shipped: new Set([...runIds].map((id) => itemOf.get(id)).filter((i): i is string => !!i && shippedIds.has(i))).size,
    });

    const byWorkflow = new Map<string, { name: string; runs: Set<string>; cost: number }>();
    const byModel = new Map<string, { model: string | null; cli: string | null; runs: Set<string>; cost: number }>();
    for (const x of r.rows) {
        const usd = Number(x.usd ?? 0);
        const w = byWorkflow.get(x.workflow_id) ?? { name: x.workflow_name ?? x.workflow_id, runs: new Set<string>(), cost: 0 };
        w.runs.add(x.run_id);
        w.cost += usd;
        byWorkflow.set(x.workflow_id, w);
        if (x.usd === null) continue;
        const key = `${x.model ?? ''}\u0000${x.cli ?? ''}`;
        const m = byModel.get(key) ?? { model: x.model, cli: x.cli, runs: new Set<string>(), cost: 0 };
        m.runs.add(x.run_id);
        m.cost += usd;
        byModel.set(key, m);
    }

    return {
        by_workflow: [...byWorkflow.entries()]
            .map(([workflow_id, w]) => {
                const t = totals(w.runs);
                return { workflow_id, name: w.name, ...row(w.runs, w.cost, t.prs, t.shipped) };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        by_model: [...byModel.values()]
            .map((m) => {
                const t = totals(m.runs);
                return { model: m.model, cli: m.cli, ...row(m.runs, m.cost, t.prs, t.shipped) };
            })
            .sort((a, b) => b.cost_usd - a.cost_usd || (a.model ?? '').localeCompare(b.model ?? '')),
    };
}

export async function spendInsight(period: IAnalyticsPeriod): Promise<IAnalyticsSpendInsight> {
    const { tz, start, end, previous_start: pStart, previous_end: pEnd, bucket: unit } = period;
    const [cur, prev, buckets] = await Promise.all([
        windowFacts(start, end, tz, unit),
        windowFacts(pStart, pEnd, tz, unit),
        windowBuckets(period),
    ]);
    const trends = Object.fromEntries(
        Object.entries(METRICS).map(([k, metric]) => [k, trendOf(cur, prev, buckets, metric)]),
    ) as Record<AnalyticsSpendTrendKey, IAnalyticsTrend>;
    return {
        buckets,
        trends,
        cost_efficiency: await costEfficiency(start, end, new Set(cur.shipped.map((s) => s.item_id))),
    };
}
