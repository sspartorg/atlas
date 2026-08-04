import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { ApiError } from '../utils/errors.js';
import { asAgentCli } from '@atlas/shared';
import {
    costRollupForRoot,
    costRowsForRoot,
    type ItemType,
} from '../services/item-cost-tree.js';

// Allow `Area/Location` style IANA names plus UTC. Anything else falls back to UTC.
const TZ_RE = /^[A-Za-z_+\-/]{1,64}$/;

function normalizeTz(raw: unknown): string {
    if (typeof raw !== 'string' || !TZ_RE.test(raw)) return 'UTC';
    return raw;
}

// Cost data changes only when a run completes, which fires an SSE event that
// invalidates the React Query cache on the client. A 30s freshness window with
// stale-while-revalidate keeps the demo feeling instant without serving lies.
const ANALYTICS_CACHE_CONTROL = 'private, max-age=30, stale-while-revalidate=120';

export interface SessionSubagentDTO {
    subagent_key: string;
    source: 'claude_jsonl' | 'copilot_list';
    agent_type: string | null;
    description: string | null;
    spawn_depth: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    cost_usd: number | null;
    is_estimate: boolean;
}

// Fetch the subagent breakdown for a batch of `cli_sessions.id`s in one
// round-trip. Returns a map keyed by session id (missing key → session
// had no subagents). Used by the topTerminalSessions responses so the
// FE can render a drill-down without an N+1 per row.
async function fetchSubagentsBySession(
    sessionIds: string[],
): Promise<Map<string, SessionSubagentDTO[]>> {
    const out = new Map<string, SessionSubagentDTO[]>();
    if (sessionIds.length === 0) return out;
    const rows = await db
        .selectFrom('cli_session_subagents')
        .select([
            'cli_session_id',
            'subagent_key',
            'source',
            'agent_type',
            'description',
            'spawn_depth',
            'input_tokens',
            'output_tokens',
            'cache_read_tokens',
            'cache_creation_tokens',
            'cost_usd',
            'is_estimate',
        ])
        .where('cli_session_id', 'in', sessionIds)
        // Claude precise cost first (highest), Copilot list rows (null) last.
        // Postgres' default for `ORDER BY DESC` is NULLS FIRST, which would
        // put unpriced Copilot / unknown-model subagents at the TOP of the
        // drill-down (mislabeling them as the highest-cost rows). Force
        // NULLS LAST to match the comment above. Kysely's `orderBy` doesn't
        // ship a NULLS LAST modifier, so we drop to a raw expression.
        .orderBy(sql`cost_usd desc nulls last`)
        .execute();
    for (const r of rows) {
        const key = r.cli_session_id as string;
        let list = out.get(key);
        if (!list) {
            list = [];
            out.set(key, list);
        }
        list.push({
            subagent_key: r.subagent_key as string,
            source: r.source as 'claude_jsonl' | 'copilot_list',
            agent_type: (r.agent_type as string | null) ?? null,
            description: (r.description as string | null) ?? null,
            spawn_depth: r.spawn_depth === null || r.spawn_depth === undefined ? null : Number(r.spawn_depth),
            input_tokens: r.input_tokens === null || r.input_tokens === undefined ? null : Number(r.input_tokens),
            output_tokens: r.output_tokens === null || r.output_tokens === undefined ? null : Number(r.output_tokens),
            cache_read_tokens:
                r.cache_read_tokens === null || r.cache_read_tokens === undefined
                    ? null
                    : Number(r.cache_read_tokens),
            cache_creation_tokens:
                r.cache_creation_tokens === null || r.cache_creation_tokens === undefined
                    ? null
                    : Number(r.cache_creation_tokens),
            cost_usd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
            is_estimate: Boolean(r.is_estimate),
        });
    }
    return out;
}

export async function analyticsRoutes(app: FastifyInstance) {
    app.get('/api/analytics', async (req, reply) => {
        reply.header('Cache-Control', ANALYTICS_CACHE_CONTROL);
        const tz = normalizeTz((req.query as { tz?: string } | undefined)?.tz);

        // Use a CTE to compute the month-start / 12-month-start in the requester's
        // timezone, so day and month buckets always reflect the viewer's wall clock.
        // We re-use these via the kysely raw `sql` template throughout.
        const monthStartSql = sql<string>`(date_trunc('month', (now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz})`;
        const twelveStartSql = sql<string>`((date_trunc('month', (now() AT TIME ZONE ${tz})) - interval '11 months') AT TIME ZONE ${tz})`;
        const monthEndSql = sql<string>`((date_trunc('month', (now() AT TIME ZONE ${tz})) + interval '1 month' - interval '1 millisecond') AT TIME ZONE ${tz})`;

        // For period.start / period.end response fields, fetch the resolved
        // boundaries as ISO strings in one tiny query so the FE can display them.
        const periodResult = await sql<{
            start: string;
            end: string;
        }>`select to_char(${monthStartSql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as start, to_char(${monthEndSql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as end`.execute(
            db,
        );
        const periodRow = periodResult.rows[0];

        const [
            summaryRow,
            dailyRows,
            byAgentRows,
            byProjectRows,
            topRunsRows,
            monthlyRows,
            // Terminal-session aggregates. Same shape as the agent_runs
            // queries above but pivot on `cli_sessions` with status='closed'
            // and `closed_at` as the period anchor. See `migration 019` —
            // these columns are populated at session close by
            // `cli-transcript-ingest.ts` via the per-CLI usage parsers.
            terminalSummaryRow,
            terminalDailyRows,
            terminalByCliRows,
            terminalByProjectRows,
            topTerminalRows,
            terminalMonthlyRows,
        ] =
            await Promise.all([
                // Summary for current month (in viewer tz)
                db
                    .selectFrom('agent_runs')
                    .select(({ fn }) => [
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                        fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                        fn.countAll<string>().as('run_count'),
                    ])
                    .where('status', '=', 'completed')
                    .where(sql`completed_at`, '>=', monthStartSql)
                    .executeTakeFirst(),

                // Daily breakdown — bucket the UTC timestamp into the viewer's local day.
                // `to_char(... AT TIME ZONE $tz, 'YYYY-MM-DD')` is a TEXT result, so the
                // pg driver returns it verbatim (no Date-object reinterpretation).
                db
                    .selectFrom('agent_runs')
                    .select(({ fn }) => [
                        sql<string>`to_char(completed_at AT TIME ZONE ${tz}, 'YYYY-MM-DD')`.as('date'),
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                        fn.countAll<string>().as('run_count'),
                    ])
                    .where('status', '=', 'completed')
                    .where(sql`completed_at`, '>=', monthStartSql)
                    .groupBy(sql`1`)
                    .orderBy(sql`1`, 'asc')
                    .execute(),

                // By agent — join agents for name
                db
                    .selectFrom('agent_runs as r')
                    .leftJoin('agents as a', 'a.id', 'r.agent_id')
                    .select(({ fn }) => [
                        'r.agent_id as agent_id',
                        'a.name as agent_name',
                        fn.sum<string>('r.total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('r.input_tokens').as('input_tokens'),
                        fn.sum<string>('r.output_tokens').as('output_tokens'),
                        fn.countAll<string>().as('run_count'),
                    ])
                    .where('r.status', '=', 'completed')
                    .where(sql`r.completed_at`, '>=', monthStartSql)
                    .groupBy(['r.agent_id', 'a.name'])
                    .orderBy(sql`SUM(r.total_cost_usd)`, 'desc')
                    .execute(),

                // By project — COALESCE(r.project_id, i.project_id)
                db
                    .selectFrom('agent_runs as r')
                    .leftJoin('items as i', 'i.id', 'r.item_id')
                    .leftJoin('projects as p', (join) =>
                        join.on(sql`p.id = COALESCE(r.project_id, i.project_id)`),
                    )
                    .select(({ fn }) => [
                        sql<string | null>`COALESCE(r.project_id, i.project_id)`.as('project_id'),
                        'p.name as project_name',
                        fn.sum<string>('r.total_cost_usd').as('total_cost_usd'),
                        fn.countAll<string>().as('run_count'),
                    ])
                    .where('r.status', '=', 'completed')
                    .where(sql`r.completed_at`, '>=', monthStartSql)
                    .groupBy(sql`COALESCE(r.project_id, i.project_id), p.name`)
                    .orderBy(sql`SUM(r.total_cost_usd)`, 'desc')
                    .execute(),

                // Top 10 most expensive runs (join items for issue type)
                db
                    .selectFrom('agent_runs as r')
                    .leftJoin('agents as a', 'a.id', 'r.agent_id')
                    .leftJoin('items as i', 'i.id', 'r.item_id')
                    .select([
                        'r.id as run_id',
                        'r.agent_id as agent_id',
                        'a.name as agent_name',
                        'i.type as issue_type',
                        'r.item_id as issue_id',
                        'r.total_cost_usd as total_cost_usd',
                        'r.input_tokens as input_tokens',
                        'r.output_tokens as output_tokens',
                        'r.cache_read_tokens as cache_read_tokens',
                        'r.created_at as created_at',
                    ])
                    .where('r.status', '=', 'completed')
                    .where(sql`r.completed_at`, '>=', monthStartSql)
                    .where('r.total_cost_usd', 'is not', null)
                    .orderBy('r.total_cost_usd', 'desc')
                    .limit(10)
                    .execute(),

                // Monthly breakdown — trailing 12 calendar months in viewer tz.
                db
                    .selectFrom('agent_runs')
                    .select(({ fn }) => [
                        sql<string>`to_char(completed_at AT TIME ZONE ${tz}, 'YYYY-MM')`.as('month'),
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                        fn.countAll<string>().as('run_count'),
                    ])
                    .where('status', '=', 'completed')
                    .where(sql`completed_at`, '>=', twelveStartSql)
                    .groupBy(sql`1`)
                    .orderBy(sql`1`, 'asc')
                    .execute(),

                // ─ Terminal session queries (cli_sessions) ─────────────────
                // Mirror the shape of the agent_runs queries above so the
                // response can stitch them onto the same daily / monthly
                // arrays. Period anchor is `closed_at` (vs `completed_at`).

                // Terminal summary (status='closed', closed this month).
                db
                    .selectFrom('cli_sessions')
                    .select(({ fn }) => [
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                        fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                        fn.countAll<string>().as('session_count'),
                    ])
                    .where('status', '=', 'closed')
                    .where(sql`closed_at`, 'is not', null)
                    .where(sql`closed_at`, '>=', monthStartSql)
                    .executeTakeFirst(),

                // Terminal daily (matched to agent daily's date key so the
                // FE can JOIN on date in plain JS). Token sums let the
                // FE render a dedicated terminal Daily card with the
                // same Input/Output/Cached stacked-bar layout the
                // agentic Daily card uses.
                db
                    .selectFrom('cli_sessions')
                    .select(({ fn }) => [
                        sql<string>`to_char(closed_at AT TIME ZONE ${tz}, 'YYYY-MM-DD')`.as('date'),
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                        fn.countAll<string>().as('session_count'),
                    ])
                    .where('status', '=', 'closed')
                    .where(sql`closed_at`, 'is not', null)
                    .where(sql`closed_at`, '>=', monthStartSql)
                    .groupBy(sql`1`)
                    .orderBy(sql`1`, 'asc')
                    .execute(),

                // Terminal by CLI — claude vs copilot.
                db
                    .selectFrom('cli_sessions')
                    .select(({ fn }) => [
                        'cli as cli',
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.sum<string>('input_tokens').as('input_tokens'),
                        fn.sum<string>('output_tokens').as('output_tokens'),
                        fn.countAll<string>().as('session_count'),
                    ])
                    .where('status', '=', 'closed')
                    .where(sql`closed_at`, 'is not', null)
                    .where(sql`closed_at`, '>=', monthStartSql)
                    .groupBy('cli')
                    .orderBy(sql`SUM(total_cost_usd)`, 'desc')
                    .execute(),

                // Terminal by project — join projects for name.
                db
                    .selectFrom('cli_sessions as s')
                    .leftJoin('projects as p', 'p.id', 's.project_id')
                    .select(({ fn }) => [
                        's.project_id as project_id',
                        'p.name as project_name',
                        fn.sum<string>('s.total_cost_usd').as('total_cost_usd'),
                        fn.countAll<string>().as('session_count'),
                    ])
                    .where('s.status', '=', 'closed')
                    .where(sql`s.closed_at`, 'is not', null)
                    .where(sql`s.closed_at`, '>=', monthStartSql)
                    .groupBy(['s.project_id', 'p.name'])
                    .orderBy(sql`SUM(s.total_cost_usd)`, 'desc')
                    .execute(),

                // Top 10 most expensive terminal sessions this month.
                db
                    .selectFrom('cli_sessions as s')
                    .leftJoin('projects as p', 'p.id', 's.project_id')
                    .select([
                        's.id as session_id',
                        's.project_id as project_id',
                        'p.name as project_name',
                        's.title as title',
                        's.cli as cli',
                        's.total_cost_usd as total_cost_usd',
                        's.input_tokens as input_tokens',
                        's.output_tokens as output_tokens',
                        's.cache_read_tokens as cache_read_tokens',
                        's.closed_at as closed_at',
                    ])
                    .where('s.status', '=', 'closed')
                    .where(sql`s.closed_at`, 'is not', null)
                    .where(sql`s.closed_at`, '>=', monthStartSql)
                    .where('s.total_cost_usd', 'is not', null)
                    .orderBy('s.total_cost_usd', 'desc')
                    .limit(10)
                    .execute(),

                // Terminal monthly — trailing 12 months, same date_trunc
                // pattern as agent runs.
                db
                    .selectFrom('cli_sessions')
                    .select(({ fn }) => [
                        sql<string>`to_char(closed_at AT TIME ZONE ${tz}, 'YYYY-MM')`.as('month'),
                        fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                        fn.countAll<string>().as('session_count'),
                    ])
                    .where('status', '=', 'closed')
                    .where(sql`closed_at`, 'is not', null)
                    .where(sql`closed_at`, '>=', twelveStartSql)
                    .groupBy(sql`1`)
                    .orderBy(sql`1`, 'asc')
                    .execute(),
            ]);

        const inputTok = Number(summaryRow?.input_tokens ?? 0);
        const cacheRead = Number(summaryRow?.cache_read_tokens ?? 0);
        const totalContextForEfficiency = inputTok + cacheRead;
        const cacheEfficiency =
            totalContextForEfficiency > 0 ? cacheRead / totalContextForEfficiency : 0;

        // ── Stitch terminal-daily / terminal-monthly into the existing
        //    daily / monthly arrays so the FE chart only has to iterate
        //    one list. Build maps keyed by date / month, then union both
        //    key sets and emit a row per key with zero defaults when one
        //    side is missing. Sort by key ascending (same order the SQL
        //    layer used for the agent queries).
        const terminalDailyByDate = new Map<
            string,
            {
                cost: number;
                count: number;
                input: number;
                output: number;
                cached: number;
            }
        >();
        for (const r of terminalDailyRows) {
            terminalDailyByDate.set(r.date as string, {
                /* v8 ignore next */
                cost: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                count: Number(r.session_count ?? 0),
                input: Number(r.input_tokens ?? 0),
                output: Number(r.output_tokens ?? 0),
                cached: Number(r.cache_read_tokens ?? 0),
            });
        }
        const agentDailyByDate = new Map<string, (typeof dailyRows)[number]>();
        for (const r of dailyRows) agentDailyByDate.set(r.date as string, r);
        const dailyKeys = Array.from(
            new Set<string>([
                ...agentDailyByDate.keys(),
                ...terminalDailyByDate.keys(),
            ]),
        ).sort();
        const dailyOut = dailyKeys.map((date) => {
            const a = agentDailyByDate.get(date);
            const t = terminalDailyByDate.get(date);
            return {
                date,
                total_cost_usd: Number(a?.total_cost_usd ?? 0),
                input_tokens: Number(a?.input_tokens ?? 0),
                output_tokens: Number(a?.output_tokens ?? 0),
                cache_read_tokens: Number(a?.cache_read_tokens ?? 0),
                run_count: Number(a?.run_count ?? 0),
                terminal_total_cost_usd: t?.cost ?? 0,
                terminal_session_count: t?.count ?? 0,
                terminal_input_tokens: t?.input ?? 0,
                terminal_output_tokens: t?.output ?? 0,
                terminal_cache_read_tokens: t?.cached ?? 0,
            };
        });

        const terminalMonthlyByMonth = new Map<string, { cost: number; count: number }>();
        for (const r of terminalMonthlyRows) {
            terminalMonthlyByMonth.set(r.month as string, {
                /* v8 ignore next */
                cost: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                count: Number(r.session_count ?? 0),
            });
        }
        const agentMonthlyByMonth = new Map<string, (typeof monthlyRows)[number]>();
        for (const r of monthlyRows) agentMonthlyByMonth.set(r.month as string, r);
        const monthlyKeys = Array.from(
            new Set<string>([
                ...agentMonthlyByMonth.keys(),
                ...terminalMonthlyByMonth.keys(),
            ]),
        ).sort();
        const monthlyOut = monthlyKeys.map((month) => {
            const a = agentMonthlyByMonth.get(month);
            const t = terminalMonthlyByMonth.get(month);
            return {
                month,
                total_cost_usd: Number(a?.total_cost_usd ?? 0),
                input_tokens: Number(a?.input_tokens ?? 0),
                output_tokens: Number(a?.output_tokens ?? 0),
                cache_read_tokens: Number(a?.cache_read_tokens ?? 0),
                run_count: Number(a?.run_count ?? 0),
                terminal_total_cost_usd: t?.cost ?? 0,
                terminal_session_count: t?.count ?? 0,
            };
        });

        return reply.send({
            period: {
                /* v8 ignore next */
                start: (periodRow?.start as string | undefined) ?? '',
                /* v8 ignore next */
                end: (periodRow?.end as string | undefined) ?? '',
                tz,
            },
            summary: {
                total_cost_usd: Number(summaryRow?.total_cost_usd ?? 0),
                input_tokens: inputTok,
                output_tokens: Number(summaryRow?.output_tokens ?? 0),
                cache_read_tokens: cacheRead,
                cache_creation_tokens: Number(summaryRow?.cache_creation_tokens ?? 0),
                /* v8 ignore next */
                run_count: Number(summaryRow?.run_count ?? 0),
            },
            daily: dailyOut,
            byAgent: byAgentRows.map((r) => ({
                agent_id: r.agent_id as string,
                /* v8 ignore next */
                agent_name: (r.agent_name as string | null) ?? (r.agent_id as string),
                /* v8 ignore next */
                total_cost_usd: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                input_tokens: Number(r.input_tokens ?? 0),
                /* v8 ignore next */
                output_tokens: Number(r.output_tokens ?? 0),
                /* v8 ignore next */
                run_count: Number(r.run_count ?? 0),
            })),
            byProject: byProjectRows.map((r) => ({
                project_id: r.project_id as string | null,
                project_name: (r.project_name as string | null) ?? 'Unknown',
                /* v8 ignore next */
                total_cost_usd: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                run_count: Number(r.run_count ?? 0),
            })),
            topRuns: topRunsRows.map((r) => ({
                run_id: r['run_id'] as string,
                agent_id: r['agent_id'] as string,
                /* v8 ignore next */
                agent_name: (r['agent_name'] as string | null) ?? (r['agent_id'] as string),
                issue_type: r['issue_type'] as string | null,
                issue_id: r['issue_id'] as string | null,
                /* v8 ignore next */
                total_cost_usd: Number(r['total_cost_usd'] ?? 0),
                /* v8 ignore next */
                input_tokens: Number(r['input_tokens'] ?? 0),
                /* v8 ignore next */
                output_tokens: Number(r['output_tokens'] ?? 0),
                /* v8 ignore next */
                cache_read_tokens: Number(r['cache_read_tokens'] ?? 0),
                created_at: r['created_at'] as string,
            })),
            monthly: monthlyOut,
            cacheEfficiency,
            // Terminal-session aggregates parallel to the agent-runs ones.
            terminalSummary: {
                total_cost_usd: Number(terminalSummaryRow?.total_cost_usd ?? 0),
                input_tokens: Number(terminalSummaryRow?.input_tokens ?? 0),
                output_tokens: Number(terminalSummaryRow?.output_tokens ?? 0),
                cache_read_tokens: Number(terminalSummaryRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(terminalSummaryRow?.cache_creation_tokens ?? 0),
                /* v8 ignore next */
                session_count: Number(terminalSummaryRow?.session_count ?? 0),
            },
            terminalByCli: terminalByCliRows.map((r) => ({
                cli: asAgentCli(r.cli),
                /* v8 ignore next */
                total_cost_usd: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                session_count: Number(r.session_count ?? 0),
                input_tokens: Number(r.input_tokens ?? 0),
                output_tokens: Number(r.output_tokens ?? 0),
            })),
            terminalByProject: terminalByProjectRows.map((r) => ({
                project_id: r.project_id as string | null,
                /* v8 ignore next */
                project_name: (r.project_name as string | null) ?? 'Unknown',
                /* v8 ignore next */
                total_cost_usd: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                session_count: Number(r.session_count ?? 0),
            })),
            topTerminalSessions: await (async () => {
                const subagentsBySession = await fetchSubagentsBySession(
                    topTerminalRows.map((r) => r['session_id'] as string),
                );
                return topTerminalRows.map((r) => {
                    const sessionId = r['session_id'] as string;
                    return {
                        session_id: sessionId,
                        /* v8 ignore next */
                        project_id: (r['project_id'] as string | null) ?? null,
                        /* v8 ignore next */
                        project_name: (r['project_name'] as string | null) ?? 'Unknown',
                        /* v8 ignore next */
                        title: (r['title'] as string | null) ?? '',
                        cli: asAgentCli(r['cli']),
                        /* v8 ignore next */
                        total_cost_usd: Number(r['total_cost_usd'] ?? 0),
                        input_tokens: Number(r['input_tokens'] ?? 0),
                        output_tokens: Number(r['output_tokens'] ?? 0),
                        cache_read_tokens: Number(r['cache_read_tokens'] ?? 0),
                        /* v8 ignore next */
                        closed_at: (r['closed_at'] as string | null) ?? '',
                        subagents: subagentsBySession.get(sessionId) ?? [],
                    };
                });
            })(),
        });
    });

    // ------------------------------------------------------------------
    // Drill-down: cost by project → epic → child item. Aggregates only
    // ever return totals + byKind + (for project) a top-N list; full
    // descendant rows are paginated through a sibling `/epics` or
    // `/children` route so the response payload stays bounded even
    // after months of run history.
    // ------------------------------------------------------------------

    app.get('/api/analytics/project/:projectId', async (req, reply) => {
        reply.header('Cache-Control', ANALYTICS_CACHE_CONTROL);
        const { projectId } = req.params as { projectId: string };

        const project = await db
            .selectFrom('projects')
            .select(['id', 'name'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!project) throw new ApiError('not_found', 'Project not found', 404);

        // One pass: every item in the project, joined to its completed
        // runs. Aggregating in SQL covers the project totals + the
        // byKind breakdown; aggregating per-epic descendant trees in
        // a separate CTE keeps `topEpics` truthful even when epics
        // have hundreds of descendants. Terminal aggregates pivot on
        // `cli_sessions` and are appended to the response so the
        // project drill-down surfaces manual sessions alongside agent
        // runs — a project funded only via terminal sessions would
        // otherwise show $0 here even though the parent /analytics
        // page reports combined spend.
        const [
            perItemRows,
            epicRollupRows,
            terminalSummaryRow,
            terminalByCliRows,
            topTerminalRows,
        ] = await Promise.all([
            sql<{
                type: string;
                cost: string | null;
                input_tokens: string | null;
                output_tokens: string | null;
                cache_read_tokens: string | null;
                run_count: string;
                item_count: string;
            }>`
                SELECT
                    i.type::text AS type,
                    COALESCE(SUM(r.total_cost_usd), 0)::text AS cost,
                    COALESCE(SUM(r.input_tokens), 0)::text AS input_tokens,
                    COALESCE(SUM(r.output_tokens), 0)::text AS output_tokens,
                    COALESCE(SUM(r.cache_read_tokens), 0)::text AS cache_read_tokens,
                    COUNT(r.id)::text AS run_count,
                    COUNT(DISTINCT i.id)::text AS item_count
                  FROM items i
                  LEFT JOIN agent_runs r
                    ON r.item_id = i.id AND r.status = 'completed'
                 WHERE i.project_id = ${projectId}
                 GROUP BY i.type
            `.execute(db),
            sql<{
                root_id: string;
                root_title: string;
                cost: string | null;
                input_tokens: string | null;
                output_tokens: string | null;
                cache_read_tokens: string | null;
                run_count: string;
                descendant_count: string;
                last_run_at: string | null;
            }>`
                WITH RECURSIVE tree(root_id, id, parent_id, type, depth) AS (
                    SELECT e.id, e.id, e.parent_id, e.type, 0
                      FROM items e
                     WHERE e.project_id = ${projectId} AND e.type = 'epic'
                    UNION ALL
                    SELECT t.root_id, i.id, i.parent_id, i.type, t.depth + 1
                      FROM items i
                      JOIN tree t ON i.parent_id = t.id
                )
                SELECT
                    tree.root_id AS root_id,
                    e.title AS root_title,
                    COALESCE(SUM(r.total_cost_usd), 0)::text AS cost,
                    COALESCE(SUM(r.input_tokens), 0)::text AS input_tokens,
                    COALESCE(SUM(r.output_tokens), 0)::text AS output_tokens,
                    COALESCE(SUM(r.cache_read_tokens), 0)::text AS cache_read_tokens,
                    COUNT(r.id)::text AS run_count,
                    (COUNT(DISTINCT tree.id) - 1)::text AS descendant_count,
                    MAX(r.completed_at)::text AS last_run_at
                  FROM tree
                  LEFT JOIN agent_runs r
                    ON r.item_id = tree.id AND r.status = 'completed'
                  LEFT JOIN items e ON e.id = tree.root_id
                 GROUP BY tree.root_id, e.title
                 ORDER BY COALESCE(SUM(r.total_cost_usd), 0) DESC, tree.root_id ASC
            `.execute(db),
            // Terminal-session summary scoped to this project. All-time
            // (matches the agent-run rollups above, which are also
            // all-time for the drill-down). Status='closed' only — same
            // discipline as the main /analytics surface.
            db
                .selectFrom('cli_sessions')
                .select(({ fn }) => [
                    fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('input_tokens').as('input_tokens'),
                    fn.sum<string>('output_tokens').as('output_tokens'),
                    fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                    fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                    fn.countAll<string>().as('session_count'),
                ])
                .where('project_id', '=', projectId)
                .where('status', '=', 'closed')
                .where(sql`closed_at`, 'is not', null)
                .executeTakeFirst(),
            // Per-CLI split (claude vs copilot) for the same project.
            db
                .selectFrom('cli_sessions')
                .select(({ fn }) => [
                    'cli as cli',
                    fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('input_tokens').as('input_tokens'),
                    fn.sum<string>('output_tokens').as('output_tokens'),
                    fn.countAll<string>().as('session_count'),
                ])
                .where('project_id', '=', projectId)
                .where('status', '=', 'closed')
                .where(sql`closed_at`, 'is not', null)
                .groupBy('cli')
                .orderBy(sql`SUM(total_cost_usd)`, 'desc')
                .execute(),
            // Top 10 most expensive closed terminal sessions in this
            // project. Mirrors the page-level topTerminalSessions
            // shape so the FE can reuse the same row component.
            db
                .selectFrom('cli_sessions as s')
                .leftJoin('projects as p', 'p.id', 's.project_id')
                .select([
                    's.id as session_id',
                    's.project_id as project_id',
                    'p.name as project_name',
                    's.title as title',
                    's.cli as cli',
                    's.total_cost_usd as total_cost_usd',
                    's.input_tokens as input_tokens',
                    's.output_tokens as output_tokens',
                    's.cache_read_tokens as cache_read_tokens',
                    's.closed_at as closed_at',
                ])
                .where('s.project_id', '=', projectId)
                .where('s.status', '=', 'closed')
                .where(sql`s.closed_at`, 'is not', null)
                .where('s.total_cost_usd', 'is not', null)
                .orderBy('s.total_cost_usd', 'desc')
                .limit(10)
                .execute(),
        ]);

        const ITEM_TYPES: readonly ItemType[] = [
            'epic',
            'story',
            'bug',
            'sub_task',
            'sub_bug',
        ];
        const isItemType = (s: string): s is ItemType =>
            (ITEM_TYPES as readonly string[]).includes(s);

        const totals = {
            total_cost_usd: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            run_count: 0,
        };
        const byKindMap = new Map<
            ItemType,
            { type: ItemType; total_cost_usd: number; run_count: number; item_count: number }
        >();
        for (const r of perItemRows.rows) {
            /* v8 ignore next */
            const c = Number(r.cost ?? 0);
            /* v8 ignore next */
            const it = Number(r.input_tokens ?? 0);
            /* v8 ignore next */
            const ot = Number(r.output_tokens ?? 0);
            /* v8 ignore next */
            const ct = Number(r.cache_read_tokens ?? 0);
            /* v8 ignore next */
            const rc = Number(r.run_count ?? 0);
            /* v8 ignore next */
            const ic = Number(r.item_count ?? 0);
            totals.total_cost_usd += c;
            totals.input_tokens += it;
            totals.output_tokens += ot;
            totals.cache_read_tokens += ct;
            totals.run_count += rc;
            /* v8 ignore next */
            if (isItemType(r.type)) {
                byKindMap.set(r.type, {
                    type: r.type,
                    total_cost_usd: c,
                    run_count: rc,
                    item_count: ic,
                });
            }
        }

        const allEpics = epicRollupRows.rows;
        const topEpics = allEpics.slice(0, 25).map((r) => ({
            id: r.root_id,
            title: r.root_title,
            /* v8 ignore next */
            descendant_count: Number(r.descendant_count ?? 0),
            last_run_at: r.last_run_at,
            totals: {
                /* v8 ignore next */
                total_cost_usd: Number(r.cost ?? 0),
                /* v8 ignore next */
                input_tokens: Number(r.input_tokens ?? 0),
                /* v8 ignore next */
                output_tokens: Number(r.output_tokens ?? 0),
                /* v8 ignore next */
                cache_read_tokens: Number(r.cache_read_tokens ?? 0),
                /* v8 ignore next */
                run_count: Number(r.run_count ?? 0),
            },
        }));

        return reply.send({
            project: { id: project.id, name: project.name },
            totals,
            byKind: ITEM_TYPES.flatMap((t) => {
                const row = byKindMap.get(t);
                return row ? [row] : [];
            }),
            topEpics,
            epic_count: allEpics.length,
            // Terminal-session aggregates for the same project. Zero-shaped
            // when no closed sessions exist so the FE can render the empty
            // state without nullable guards.
            terminalSummary: {
                total_cost_usd: Number(terminalSummaryRow?.total_cost_usd ?? 0),
                input_tokens: Number(terminalSummaryRow?.input_tokens ?? 0),
                output_tokens: Number(terminalSummaryRow?.output_tokens ?? 0),
                cache_read_tokens: Number(terminalSummaryRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(terminalSummaryRow?.cache_creation_tokens ?? 0),
                /* v8 ignore next */
                session_count: Number(terminalSummaryRow?.session_count ?? 0),
            },
            terminalByCli: terminalByCliRows.map((r) => ({
                cli: asAgentCli(r.cli),
                /* v8 ignore next */
                total_cost_usd: Number(r.total_cost_usd ?? 0),
                /* v8 ignore next */
                session_count: Number(r.session_count ?? 0),
                /* v8 ignore next */
                input_tokens: Number(r.input_tokens ?? 0),
                /* v8 ignore next */
                output_tokens: Number(r.output_tokens ?? 0),
            })),
            topTerminalSessions: await (async () => {
                const subagentsBySession = await fetchSubagentsBySession(
                    topTerminalRows.map((r) => r['session_id'] as string),
                );
                return topTerminalRows.map((r) => {
                    const sessionId = r['session_id'] as string;
                    return {
                        session_id: sessionId,
                        /* v8 ignore next */
                        project_id: (r['project_id'] as string | null) ?? null,
                        /* v8 ignore next */
                        project_name: (r['project_name'] as string | null) ?? 'Unknown',
                        /* v8 ignore next */
                        title: (r['title'] as string | null) ?? '',
                        cli: asAgentCli(r['cli']),
                        /* v8 ignore next */
                        total_cost_usd: Number(r['total_cost_usd'] ?? 0),
                        /* v8 ignore next */
                        input_tokens: Number(r['input_tokens'] ?? 0),
                        /* v8 ignore next */
                        output_tokens: Number(r['output_tokens'] ?? 0),
                        /* v8 ignore next */
                        cache_read_tokens: Number(r['cache_read_tokens'] ?? 0),
                        /* v8 ignore next */
                        closed_at: (r['closed_at'] as string | null) ?? '',
                        subagents: subagentsBySession.get(sessionId) ?? [],
                    };
                });
            })(),
        });
    });

    app.get('/api/analytics/project/:projectId/epics', async (req, reply) => {
        reply.header('Cache-Control', ANALYTICS_CACHE_CONTROL);
        const { projectId } = req.params as { projectId: string };
        const q = req.query as { page?: string; limit?: string };
        const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '25', 10) || 25));
        const offset = (page - 1) * limit;

        const project = await db
            .selectFrom('projects')
            .select(['id'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!project) throw new ApiError('not_found', 'Project not found', 404);

        const result = await sql<{
            root_id: string;
            root_title: string;
            cost: string | null;
            input_tokens: string | null;
            output_tokens: string | null;
            cache_read_tokens: string | null;
            run_count: string;
            descendant_count: string;
            last_run_at: string | null;
            total_rows: string;
        }>`
            WITH RECURSIVE tree(root_id, id, parent_id, depth) AS (
                SELECT e.id, e.id, e.parent_id, 0
                  FROM items e
                 WHERE e.project_id = ${projectId} AND e.type = 'epic'
                UNION ALL
                SELECT t.root_id, i.id, i.parent_id, t.depth + 1
                  FROM items i
                  JOIN tree t ON i.parent_id = t.id
            ),
            rolled AS (
                SELECT
                    tree.root_id AS root_id,
                    e.title AS root_title,
                    COALESCE(SUM(r.total_cost_usd), 0) AS cost_num,
                    COALESCE(SUM(r.input_tokens), 0) AS input_tokens_num,
                    COALESCE(SUM(r.output_tokens), 0) AS output_tokens_num,
                    COALESCE(SUM(r.cache_read_tokens), 0) AS cache_read_tokens_num,
                    COUNT(r.id) AS run_count_num,
                    COUNT(DISTINCT tree.id) - 1 AS descendant_count_num,
                    MAX(r.completed_at) AS last_run_at_ts
                  FROM tree
                  LEFT JOIN agent_runs r
                    ON r.item_id = tree.id AND r.status = 'completed'
                  LEFT JOIN items e ON e.id = tree.root_id
                 GROUP BY tree.root_id, e.title
            )
            SELECT
                root_id,
                root_title,
                cost_num::text AS cost,
                input_tokens_num::text AS input_tokens,
                output_tokens_num::text AS output_tokens,
                cache_read_tokens_num::text AS cache_read_tokens,
                run_count_num::text AS run_count,
                descendant_count_num::text AS descendant_count,
                last_run_at_ts::text AS last_run_at,
                COUNT(*) OVER ()::text AS total_rows
              FROM rolled
             ORDER BY cost_num DESC, root_id ASC
             LIMIT ${limit} OFFSET ${offset}
        `.execute(db);

        const rows = result.rows.map((r) => ({
            id: r.root_id,
            title: r.root_title,
            /* v8 ignore next */
            descendant_count: Number(r.descendant_count ?? 0),
            last_run_at: r.last_run_at,
            totals: {
                /* v8 ignore next */
                total_cost_usd: Number(r.cost ?? 0),
                /* v8 ignore next */
                input_tokens: Number(r.input_tokens ?? 0),
                /* v8 ignore next */
                output_tokens: Number(r.output_tokens ?? 0),
                /* v8 ignore next */
                cache_read_tokens: Number(r.cache_read_tokens ?? 0),
                /* v8 ignore next */
                run_count: Number(r.run_count ?? 0),
            },
        }));
        const total =
            /* v8 ignore next */
            result.rows.length > 0 ? Number(result.rows[0]?.total_rows ?? 0) : 0;

        return reply.send({ rows, total, page, limit });
    });

    app.get('/api/analytics/epic/:epicId', async (req, reply) => {
        reply.header('Cache-Control', ANALYTICS_CACHE_CONTROL);
        const { epicId } = req.params as { epicId: string };

        const epic = await db
            .selectFrom('items')
            .leftJoin('projects', 'projects.id', 'items.project_id')
            .select([
                'items.id as id',
                'items.title as title',
                'items.type as type',
                'items.project_id as project_id',
                'projects.name as project_name',
            ])
            .where('items.id', '=', epicId)
            .executeTakeFirst();
        if (!epic) throw new ApiError('not_found', 'Epic not found', 404);
        if (epic.type !== 'epic') {
            throw new ApiError('not_found', 'Item is not an epic', 404);
        }

        const rollup = await costRollupForRoot(epicId);

        return reply.send({
            epic: {
                id: epic.id,
                title: epic.title,
                /* v8 ignore next */
                project_id: epic.project_id ?? '',
                /* v8 ignore next */
                project_name: epic.project_name ?? '',
            },
            totals: rollup.totals,
            byKind: rollup.byKind,
            descendant_count: rollup.descendant_count,
        });
    });

    app.get('/api/analytics/epic/:epicId/children', async (req, reply) => {
        reply.header('Cache-Control', ANALYTICS_CACHE_CONTROL);
        const { epicId } = req.params as { epicId: string };
        const q = req.query as { page?: string; limit?: string; type?: string };
        const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '25', 10) || 25));

        const epic = await db
            .selectFrom('items')
            .select(['id', 'type'])
            .where('id', '=', epicId)
            .executeTakeFirst();
        if (!epic) throw new ApiError('not_found', 'Epic not found', 404);
        if (epic.type !== 'epic') {
            throw new ApiError('not_found', 'Item is not an epic', 404);
        }

        const ITEM_TYPES: readonly ItemType[] = [
            'epic',
            'story',
            'bug',
            'sub_task',
            'sub_bug',
        ];
        const typeFilter = q.type && (ITEM_TYPES as readonly string[]).includes(q.type)
            ? (q.type as ItemType)
            : undefined;

        const result = await costRowsForRoot(epicId, {
            page,
            limit,
            ...(typeFilter !== undefined ? { type: typeFilter } : {}),
        });
        return reply.send(result);
    });
}
