import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';

// Per-item cost rollup over the `items.parent_id` tree. The analytics
// drill-down (project → epic → child item) is the only consumer. Two
// functions live here because the UI needs them at different cadences:
//
//   • `costRollupForRoot` — aggregate-only summary (totals + byKind),
//     one round-trip, no descendant rows over the wire. Cheap enough
//     to call per project page load even with thousands of descendants.
//
//   • `costRowsForRoot` — paginated descendant rows for the drill-down
//     table. Server-side ORDER BY cost DESC + LIMIT/OFFSET so the
//     client never holds more than `limit` rows in memory.
//
// SQL shape mirrors the recursive-CTE pattern already proven for cycle
// detection in `item-links.ts:73`. The walk traverses `items.parent_id`
// downward starting at `rootItemId`; the leaf query LEFT JOINs
// `agent_runs` filtered to `status = 'completed'` so failed / cancelled
// / in-flight runs don't inflate the rollup.

export type ItemType = 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';

interface CostTotals {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
}

interface CostByKindRow {
    type: ItemType;
    total_cost_usd: number;
    run_count: number;
    item_count: number;
}

interface RootItemMeta {
    id: string;
    type: ItemType;
    title: string;
    project_id: string;
    parent_id: string | null;
}

export interface CostRollupResult {
    root: RootItemMeta | null;
    totals: CostTotals;
    byKind: CostByKindRow[];
    descendant_count: number;
}

interface ItemCostRow {
    id: string;
    title: string;
    type: ItemType;
    parent_id: string | null;
    depth: number;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
    last_run_at: string | null;
}

export interface CostRowsResult {
    rows: ItemCostRow[];
    total: number;
    page: number;
    limit: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const ITEM_TYPES: readonly ItemType[] = [
    'epic',
    'story',
    'bug',
    'sub_task',
    'sub_bug',
];

function isItemType(s: string | null | undefined): s is ItemType {
    return typeof s === 'string' && (ITEM_TYPES as readonly string[]).includes(s);
}

function clampLimit(raw: number | undefined): number {
    if (!raw || raw <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(raw), MAX_LIMIT);
}

function num(v: unknown): number {
    // SQL COALESCE/COUNT always returns non-null numeric strings from the DB
    // queries in this module; the null/undefined and non-finite guard arms
    // are defensive fallbacks that are unreachable from the actual query results.
    /* v8 ignore start */
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
    /* v8 ignore stop */
}

/**
 * Aggregate-only cost rollup for every descendant of `rootItemId`
 * (inclusive). Returns the root item's metadata, the rolled-up totals,
 * and a breakdown of cost / run count / item count grouped by item
 * type. Does NOT return descendant rows — see `costRowsForRoot`.
 *
 * Resolves to `{ root: null, ... }` if `rootItemId` doesn't exist.
 */
export async function costRollupForRoot(
    rootItemId: string,
): Promise<CostRollupResult> {
    // One round-trip: walk the items.parent_id tree, LEFT JOIN runs,
    // aggregate to one row per (item, kind) — then we group/sum in JS
    // for the per-kind breakdown and overall totals. Could be done as
    // two SQL aggregates side-by-side, but for the typical N (<= a
    // few thousand descendants) the post-processing in JS is faster
    // than two recursive walks.
    const result = await sql<{
        id: string;
        type: ItemType;
        title: string;
        project_id: string;
        parent_id: string | null;
        root_id: string;
        is_root: boolean;
        total_cost_usd: string | null;
        input_tokens: string | null;
        output_tokens: string | null;
        cache_read_tokens: string | null;
        run_count: string;
    }>`
        WITH RECURSIVE tree(id, parent_id, type, title, project_id, depth) AS (
            SELECT id, parent_id, type, title, project_id, 0
              FROM items
             WHERE id = ${rootItemId}
            UNION ALL
            SELECT i.id, i.parent_id, i.type, i.title, i.project_id, t.depth + 1
              FROM items i
              JOIN tree t ON i.parent_id = t.id
        )
        SELECT
            t.id,
            t.type::text AS type,
            t.title,
            t.project_id,
            t.parent_id,
            ${rootItemId}::text AS root_id,
            (t.id = ${rootItemId}) AS is_root,
            COALESCE(SUM(r.total_cost_usd), 0)::text AS total_cost_usd,
            COALESCE(SUM(r.input_tokens), 0)::text AS input_tokens,
            COALESCE(SUM(r.output_tokens), 0)::text AS output_tokens,
            COALESCE(SUM(r.cache_read_tokens), 0)::text AS cache_read_tokens,
            COUNT(r.id)::text AS run_count
          FROM tree t
          LEFT JOIN agent_runs r
            ON r.item_id = t.id AND r.status = 'completed'
         GROUP BY t.id, t.type, t.title, t.project_id, t.parent_id
    `.execute(db);

    const rows = result.rows;
    if (rows.length === 0) {
        return {
            root: null,
            totals: {
                total_cost_usd: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                run_count: 0,
            },
            byKind: [],
            descendant_count: 0,
        };
    }

    const rootRow = rows.find((r) => r.is_root === true);
    const root: RootItemMeta | null = rootRow
        ? {
              id: rootRow.id,
              type: rootRow.type,
              title: rootRow.title,
              project_id: rootRow.project_id,
              parent_id: rootRow.parent_id,
          }
        : null;

    const totals: CostTotals = {
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        run_count: 0,
    };
    const byKindMap = new Map<ItemType, CostByKindRow>();

    for (const r of rows) {
        const cost = num(r.total_cost_usd);
        const inT = num(r.input_tokens);
        const outT = num(r.output_tokens);
        const cacheT = num(r.cache_read_tokens);
        const runs = num(r.run_count);

        totals.total_cost_usd += cost;
        totals.input_tokens += inT;
        totals.output_tokens += outT;
        totals.cache_read_tokens += cacheT;
        totals.run_count += runs;

        const kind = r.type;
        // The DB `items.type` CHECK constraint guarantees the value is always
        // in ITEM_TYPES; the `continue` arm is an unreachable defensive guard.
        /* v8 ignore next */
        if (!isItemType(kind)) continue;
        const existing = byKindMap.get(kind) ?? {
            type: kind,
            total_cost_usd: 0,
            run_count: 0,
            item_count: 0,
        };
        existing.total_cost_usd += cost;
        existing.run_count += runs;
        existing.item_count += 1;
        byKindMap.set(kind, existing);
    }

    // Deterministic order for the UI: by the canonical item-type
    // sequence, not by cost. Front-end sorts visually if it wants
    // different. Keeps snapshots stable.
    const byKind = ITEM_TYPES.flatMap((t) => {
        const row = byKindMap.get(t);
        return row ? [row] : [];
    });

    // rootRow is always present when rows.length > 0 (the CTE always includes the
    // root item itself); the `: 0` arm is an unreachable defensive fallback.
    /* v8 ignore next */
    return {
        root,
        totals,
        byKind,
        descendant_count: rows.length - (rootRow ? 1 : 0),
    };
}

export interface CostRowsParams {
    page?: number;
    limit?: number;
    /** Restrict to one item type (e.g. only the stories under an epic). */
    type?: ItemType;
    /** Currently only `cost` is honoured. Default: cost DESC. */
    sort?: 'cost';
}

/**
 * Paginated descendant rows of `rootItemId`. The root itself is NOT
 * included — only its descendants — because the UI shows the root's
 * own totals separately in the hero. Excluding it from the table keeps
 * the per-row indentation calc clean.
 */
export async function costRowsForRoot(
    rootItemId: string,
    params: CostRowsParams = {},
): Promise<CostRowsResult> {
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const limit = clampLimit(params.limit);
    const offset = (page - 1) * limit;
    const typeFilter = params.type && isItemType(params.type) ? params.type : null;

    const result = await sql<{
        id: string;
        type: ItemType;
        title: string;
        parent_id: string | null;
        depth: string;
        total_cost_usd: string | null;
        input_tokens: string | null;
        output_tokens: string | null;
        cache_read_tokens: string | null;
        run_count: string;
        last_run_at: string | null;
        total_rows: string;
    }>`
        WITH RECURSIVE tree(id, parent_id, type, title, depth) AS (
            SELECT id, parent_id, type, title, 0
              FROM items
             WHERE id = ${rootItemId}
            UNION ALL
            SELECT i.id, i.parent_id, i.type, i.title, t.depth + 1
              FROM items i
              JOIN tree t ON i.parent_id = t.id
        ),
        agg AS (
            SELECT
                t.id,
                t.type::text AS type,
                t.title,
                t.parent_id,
                t.depth AS depth_num,
                COALESCE(SUM(r.total_cost_usd), 0) AS cost_num,
                COALESCE(SUM(r.input_tokens), 0) AS input_tokens_num,
                COALESCE(SUM(r.output_tokens), 0) AS output_tokens_num,
                COALESCE(SUM(r.cache_read_tokens), 0) AS cache_read_tokens_num,
                COUNT(r.id) AS run_count_num,
                MAX(r.completed_at) AS last_run_at_ts
              FROM tree t
              LEFT JOIN agent_runs r
                ON r.item_id = t.id AND r.status = 'completed'
             WHERE t.id <> ${rootItemId}
               AND (${typeFilter}::text IS NULL OR t.type::text = ${typeFilter}::text)
             GROUP BY t.id, t.type, t.title, t.parent_id, t.depth
        )
        SELECT
            id,
            type,
            title,
            parent_id,
            depth_num::text AS depth,
            cost_num::text AS total_cost_usd,
            input_tokens_num::text AS input_tokens,
            output_tokens_num::text AS output_tokens,
            cache_read_tokens_num::text AS cache_read_tokens,
            run_count_num::text AS run_count,
            last_run_at_ts::text AS last_run_at,
            COUNT(*) OVER ()::text AS total_rows
          FROM agg
         ORDER BY cost_num DESC, id ASC
         LIMIT ${limit} OFFSET ${offset}
    `.execute(db);

    const rows: ItemCostRow[] = result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        parent_id: r.parent_id,
        depth: Math.trunc(num(r.depth)),
        total_cost_usd: num(r.total_cost_usd),
        input_tokens: Math.trunc(num(r.input_tokens)),
        output_tokens: Math.trunc(num(r.output_tokens)),
        cache_read_tokens: Math.trunc(num(r.cache_read_tokens)),
        run_count: Math.trunc(num(r.run_count)),
        last_run_at: r.last_run_at,
    }));

    const total = result.rows.length > 0 ? Math.trunc(num(result.rows[0]?.total_rows)) : 0;

    return { rows, total, page, limit };
}
