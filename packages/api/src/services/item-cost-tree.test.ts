// Item cost tree (analytics drill-down). Covers the recursive-CTE rollup +
// the paginated rows endpoint. Exercises pagination clamps, empty cases,
// optional type filter, and the cache-read tokens / depth fields.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { costRollupForRoot, costRowsForRoot } from './item-cost-tree.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
});

afterAll(async () => {
    await closeTestDb();
});

async function seedRun(input: {
    id: string;
    item_id: string;
    status: string;
    cost?: number;
    input_t?: number;
    output_t?: number;
    cache_read_t?: number;
    completed_at?: string;
}) {
    await testDb
        .insertInto('agent_runs')
        .values({
            id: input.id,
            agent_id: 'agent-coder',
            item_id: input.item_id,
            status: input.status as 'completed',
            total_cost_usd: String(input.cost ?? 0) as unknown as number,
            input_tokens: String(input.input_t ?? 0) as unknown as number,
            output_tokens: String(input.output_t ?? 0) as unknown as number,
            cache_read_tokens: String(input.cache_read_t ?? 0) as unknown as number,
            completed_at: input.completed_at ?? null,
        })
        .execute();
}

describe('costRollupForRoot', () => {
    it('returns empty rollup when root id does not exist', async () => {
        const r = await costRollupForRoot('does-not-exist');
        expect(r.root).toBeNull();
        expect(r.totals.total_cost_usd).toBe(0);
        expect(r.byKind).toEqual([]);
        expect(r.descendant_count).toBe(0);
    });

    it('sums costs across the descendant tree grouped by kind in canonical order', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'S1',
        });
        await insertItem({
            id: 'ATL-3',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'S2',
        });
        await seedRun({
            id: 'r1',
            item_id: 'ATL-2',
            status: 'completed',
            cost: 1.5,
            input_t: 100,
            output_t: 50,
            cache_read_t: 20,
            completed_at: new Date().toISOString(),
        });
        await seedRun({
            id: 'r2',
            item_id: 'ATL-3',
            status: 'completed',
            cost: 0.5,
            input_t: 30,
            output_t: 10,
            cache_read_t: 5,
            completed_at: new Date().toISOString(),
        });
        // Failed runs must NOT inflate the rollup.
        await seedRun({
            id: 'r3',
            item_id: 'ATL-2',
            status: 'error',
            cost: 99,
            completed_at: new Date().toISOString(),
        });

        const r = await costRollupForRoot('ATL-1');
        expect(r.root?.id).toBe('ATL-1');
        expect(r.root?.type).toBe('epic');
        expect(r.totals.total_cost_usd).toBeCloseTo(2.0, 5);
        expect(r.totals.input_tokens).toBe(130);
        expect(r.totals.output_tokens).toBe(60);
        expect(r.totals.cache_read_tokens).toBe(25);
        expect(r.totals.run_count).toBe(2);
        // 2 stories are descendants of the epic.
        expect(r.descendant_count).toBe(2);
        const storyRow = r.byKind.find((k) => k.type === 'story');
        expect(storyRow?.item_count).toBe(2);
        expect(storyRow?.total_cost_usd).toBeCloseTo(2.0, 5);
        // The root epic still appears in byKind as its own group (0 cost since no runs on it).
        const epicRow = r.byKind.find((k) => k.type === 'epic');
        expect(epicRow?.item_count).toBe(1);
    });

    it('handles a root with no descendants (single row, no runs)', async () => {
        await insertItem({ id: 'solo', type: 'epic', project_id: 'p1', title: 'lonely' });
        const r = await costRollupForRoot('solo');
        expect(r.root?.id).toBe('solo');
        expect(r.descendant_count).toBe(0);
        expect(r.totals.run_count).toBe(0);
    });
});

describe('costRowsForRoot', () => {
    beforeEach(async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        await insertItem({
            id: 'ATL-2',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'High-cost',
        });
        await insertItem({
            id: 'ATL-3',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Low-cost',
        });
        await insertItem({
            id: 'ATL-4',
            type: 'bug',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'Bug',
            acceptance_criteria: '',
            steps_to_reproduce: '',
            expected: '',
            actual: '',
            frequency: 'sometimes',
            failure_scope: 'cosmetic',
        });
        await seedRun({
            id: 'r-high',
            item_id: 'ATL-2',
            status: 'completed',
            cost: 5,
            completed_at: new Date().toISOString(),
        });
        await seedRun({
            id: 'r-low',
            item_id: 'ATL-3',
            status: 'completed',
            cost: 1,
            completed_at: new Date().toISOString(),
        });
    });

    it('returns descendant rows ordered by cost DESC (excluding the root)', async () => {
        const r = await costRowsForRoot('ATL-1');
        expect(r.rows.length).toBe(3);
        expect(r.rows[0]!.id).toBe('ATL-2');
        // total rows reflects the unpaginated count.
        expect(r.total).toBe(3);
        expect(r.page).toBe(1);
        expect(r.limit).toBe(25);
        // Root is NOT in the rows.
        expect(r.rows.find((row) => row.id === 'ATL-1')).toBeUndefined();
    });

    it('honours the type filter (only stories)', async () => {
        const r = await costRowsForRoot('ATL-1', { type: 'story' });
        expect(r.rows.map((row) => row.id).sort()).toEqual(['ATL-2', 'ATL-3']);
        expect(r.total).toBe(2);
    });

    it('clamps oversized and zero/negative limits', async () => {
        // All branches of clampLimit (raw>0 within range, raw>MAX, raw<=0 / undefined)
        // exercised in one DB round-trip per call.
        expect((await costRowsForRoot('ATL-1', { limit: 9999 })).limit).toBe(100);
        expect((await costRowsForRoot('ATL-1', { limit: -10 })).limit).toBe(25);
        expect((await costRowsForRoot('ATL-1', {})).limit).toBe(25);
    });

    it('returns empty rows for an empty page (offset past end)', async () => {
        const r = await costRowsForRoot('ATL-1', { page: 99, limit: 10 });
        expect(r.rows).toEqual([]);
        expect(r.total).toBe(0);
    });

    it('returns last_run_at as null when there are no completed runs', async () => {
        await insertItem({
            id: 'ATL-norun',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-1',
            parent_type: 'epic',
            title: 'No runs',
        });
        const r = await costRowsForRoot('ATL-1');
        const row = r.rows.find((x) => x.id === 'ATL-norun');
        expect(row?.last_run_at).toBeNull();
        expect(row?.total_cost_usd).toBe(0);
    });
});
