import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { getItem } from './items.js';
import { eventsLog } from './events-log.js';
import type { ItemRelation, ItemType } from '../db/types.js';
import type { IssueStatus } from '@atlas/shared';

// Record a link create/delete event on both endpoints so each item's activity
// tab surfaces the change. Direction is encoded in `detail` so the rendering
// side can show "depends on ATL-3" vs "blocked by ATL-2" without re-fetching
// the link row.
async function recordLinkEvent(
    eventType: 'link_created' | 'link_deleted',
    fromId: string,
    toId: string,
    relation: ItemRelation,
): Promise<void> {
    await Promise.all([
        eventsLog.record({
            item_id: fromId,
            event_type: eventType,
            field: 'link',
            to_value: toId,
            detail: `${relation} → ${toId}`,
        }),
        eventsLog.record({
            item_id: toId,
            event_type: eventType,
            field: 'link',
            to_value: fromId,
            detail: `${relation} ← ${fromId}`,
        }),
    ]);
}

interface IItemLink {
    id: number;
    from_id: string;
    to_id: string;
    relation_type: ItemRelation;
    created_at: string;
}

/**
 * A link enriched with the related item's display info, for the UI table.
 * `type/item_id` always point at the OTHER side of the link relative to the
 * caller; `direction` tells the UI whether the caller blocks the target or is
 * blocked by it (only meaningful for depends_on).
 */
export interface IItemLinkRow {
    id: number;
    relation_type: ItemRelation;
    direction: 'outgoing' | 'incoming';
    type: ItemType;
    item_id: string;
    short_id: string;
    title: string;
    status: IssueStatus;
    created_at: string;
}

export interface ICreateLinkResult {
    ok: boolean;
    link?: IItemLink;
    reason?: 'self' | 'not_found' | 'cycle' | 'missing_from';
}

// ----------------------------------------------------------------------------
// Cycle detection — used ONLY for depends_on. relates_to is undirected so a
// cycle isn't semantically meaningful.
// ----------------------------------------------------------------------------

async function wouldCreateDependsOnCycle(fromId: string, toId: string): Promise<boolean> {
    // The caller already guards with `fromId === toId → 'self'` before calling
    // this function; this defensive guard is unreachable from create().
    /* v8 ignore next */
    if (fromId === toId) return true;
    // Walk depends_on edges starting at `toId`. If we ever reach `fromId`,
    // adding from -> to would close a cycle.
    const result = await sql<{ exists: boolean }>`
        WITH RECURSIVE walk(node) AS (
            SELECT ${toId}::text
            UNION
            SELECT l.to_id
              FROM item_links l
              JOIN walk w ON l.from_id = w.node
             WHERE l.relation_type = 'depends_on'
        )
        SELECT EXISTS (SELECT 1 FROM walk WHERE node = ${fromId}) AS exists
    `.execute(db);
    return Boolean(result.rows[0]?.exists);
}

// ----------------------------------------------------------------------------
// Normalize relates_to pair: store with the lexicographically smaller id as
// `from_id` so duplicates in either direction collapse onto one row.
// ----------------------------------------------------------------------------

function normalizeRelatesTo(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------

export const itemLinks = {
    /** All links touching this item, grouped by relation type. */
    async list(itemId: string): Promise<IItemLinkRow[]> {
        // One query for outgoing links + one for incoming. Simpler than a
        // self-join with an OR condition and equally cheap on indexed columns.
        const [outgoing, incoming] = await Promise.all([
            db
                .selectFrom('item_links as l')
                .innerJoin('items as t', 't.id', 'l.to_id')
                .select([
                    'l.id as id',
                    'l.relation_type as relation_type',
                    'l.created_at as created_at',
                    't.id as t_id',
                    't.type as t_type',
                    't.title as t_title',
                    't.status as t_status',
                ])
                .where('l.from_id', '=', itemId)
                .execute(),
            db
                .selectFrom('item_links as l')
                .innerJoin('items as t', 't.id', 'l.from_id')
                .select([
                    'l.id as id',
                    'l.relation_type as relation_type',
                    'l.created_at as created_at',
                    't.id as t_id',
                    't.type as t_type',
                    't.title as t_title',
                    't.status as t_status',
                ])
                .where('l.to_id', '=', itemId)
                .execute(),
        ]);

        const rows: IItemLinkRow[] = [];
        for (const r of outgoing) {
            rows.push({
                id: r.id as number,
                relation_type: r.relation_type as ItemRelation,
                direction: 'outgoing',
                type: r.t_type as ItemType,
                item_id: r.t_id as string,
                short_id: r.t_id as string,
                title: r.t_title as string,
                status: r.t_status as IssueStatus,
                created_at: r.created_at as string,
            });
        }
        for (const r of incoming) {
            rows.push({
                id: r.id as number,
                relation_type: r.relation_type as ItemRelation,
                direction: 'incoming',
                type: r.t_type as ItemType,
                item_id: r.t_id as string,
                short_id: r.t_id as string,
                title: r.t_title as string,
                status: r.t_status as IssueStatus,
                created_at: r.created_at as string,
            });
        }
        rows.sort((a, b) => {
            if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
            return a.id - b.id;
        });
        return rows;
    },

    /** Open `depends_on` blockers of `itemId` — items that block `itemId` from
     *  progressing because they aren't done yet. */
    async openBlockers(itemId: string): Promise<Array<{ id: string; title: string; status: IssueStatus }>> {
        const rows = await db
            .selectFrom('item_links as l')
            .innerJoin('items as t', 't.id', 'l.to_id')
            .select(['t.id as id', 't.title as title', 't.status as status'])
            .where('l.from_id', '=', itemId)
            .where('l.relation_type', '=', 'depends_on')
            .where('t.status', '!=', 'done')
            .execute();
        return rows as Array<{ id: string; title: string; status: IssueStatus }>;
    },

    /** Items that depend on `itemId` (i.e. would unblock when `itemId` reaches `done`). */
    async dependents(itemId: string): Promise<string[]> {
        const rows = await db
            .selectFrom('item_links')
            .select('from_id')
            .where('to_id', '=', itemId)
            .where('relation_type', '=', 'depends_on')
            .execute();
        return rows.map((r) => r.from_id);
    },

    /** Create a link. Idempotent. For relates_to, normalizes direction. For
     *  depends_on, performs cycle detection. */
    async create(
        fromId: string,
        toId: string,
        relation: ItemRelation,
    ): Promise<ICreateLinkResult> {
        if (fromId === toId) return { ok: false, reason: 'self' };
        const from = await getItem(fromId);
        if (!from) return { ok: false, reason: 'missing_from' };
        const to = await getItem(toId);
        if (!to) return { ok: false, reason: 'not_found' };

        if (relation === 'depends_on') {
            if (await wouldCreateDependsOnCycle(fromId, toId)) {
                return { ok: false, reason: 'cycle' };
            }
            const inserted = await db
                .insertInto('item_links')
                .values({ from_id: fromId, to_id: toId, relation_type: 'depends_on' })
                .onConflict((oc) => oc.columns(['from_id', 'to_id', 'relation_type']).doNothing())
                .returningAll()
                .executeTakeFirst();
            if (inserted) {
                await recordLinkEvent('link_created', fromId, toId, 'depends_on');
                return { ok: true, link: inserted as unknown as IItemLink };
            }
            const existing = await db
                .selectFrom('item_links')
                .selectAll()
                .where('from_id', '=', fromId)
                .where('to_id', '=', toId)
                .where('relation_type', '=', 'depends_on')
                .executeTakeFirst();
            // The `: { ok: false, reason: 'not_found' }` arm is an unreachable
            // defensive fallback — it would require a concurrent DELETE between
            // the INSERT doNothing and this SELECT.
            /* v8 ignore next */
            return existing
                ? { ok: true, link: existing as unknown as IItemLink }
                : { ok: false, reason: 'not_found' };
        }

        if (relation === 'tested_by') {
            // Directed (from = QA story, to = dev story). No symmetric
            // normalization — swapping the endpoints would invert the
            // semantic. No cycle check either: tested_by edges form a
            // dev↔QA pairing, not a dependency chain.
            const inserted = await db
                .insertInto('item_links')
                .values({ from_id: fromId, to_id: toId, relation_type: 'tested_by' })
                .onConflict((oc) => oc.columns(['from_id', 'to_id', 'relation_type']).doNothing())
                .returningAll()
                .executeTakeFirst();
            if (inserted) {
                await recordLinkEvent('link_created', fromId, toId, 'tested_by');
                return { ok: true, link: inserted as unknown as IItemLink };
            }
            const existing = await db
                .selectFrom('item_links')
                .selectAll()
                .where('from_id', '=', fromId)
                .where('to_id', '=', toId)
                .where('relation_type', '=', 'tested_by')
                .executeTakeFirst();
            // Unreachable defensive fallback — concurrent DELETE between INSERT and SELECT.
            /* v8 ignore next */
            return existing
                ? { ok: true, link: existing as unknown as IItemLink }
                : { ok: false, reason: 'not_found' };
        }

        // relates_to: collapse symmetric pair to canonical form
        const [a, b] = normalizeRelatesTo(fromId, toId);
        const inserted = await db
            .insertInto('item_links')
            .values({ from_id: a, to_id: b, relation_type: 'relates_to' })
            .onConflict((oc) => oc.columns(['from_id', 'to_id', 'relation_type']).doNothing())
            .returningAll()
            .executeTakeFirst();
        if (inserted) {
            await recordLinkEvent('link_created', a, b, 'relates_to');
            return { ok: true, link: inserted as unknown as IItemLink };
        }
        const existing = await db
            .selectFrom('item_links')
            .selectAll()
            .where('from_id', '=', a)
            .where('to_id', '=', b)
            .where('relation_type', '=', 'relates_to')
            .executeTakeFirst();
        // Unreachable defensive fallback — concurrent DELETE between INSERT and SELECT.
        /* v8 ignore next */
        return existing
            ? { ok: true, link: existing as unknown as IItemLink }
            : { ok: false, reason: 'not_found' };
    },

    async delete(linkId: number): Promise<void> {
        const row = await db
            .selectFrom('item_links')
            .select(['from_id', 'to_id', 'relation_type'])
            .where('id', '=', linkId)
            .executeTakeFirst();
        await db.deleteFrom('item_links').where('id', '=', linkId).execute();
        if (row) {
            await recordLinkEvent(
                'link_deleted',
                row.from_id,
                row.to_id,
                row.relation_type as ItemRelation,
            );
        }
    },
};
