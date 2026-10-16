import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { deliveryAnalytics, countShippedTasks, percentileCont } from './analytics-delivery.js';
import { resolveWindow } from './analytics-window.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertItem, insertProject } from '../../tests/_items.js';

// Delivery maths over hand-built status histories. The clock is pinned to
// 2026-10-16 06:30Z = 12:00 in Asia/Kolkata (UTC+5:30), so the 7-day window
// is Oct 10 00:00 IST (2026-10-09T18:30Z) → now, and its previous window is
// Oct 3 00:00 IST → Oct 10 00:00 IST. Every expected number below is worked
// out by hand in the comment next to it.

const NOW = new Date('2026-10-16T06:30:00Z');
const TZ = 'Asia/Kolkata';
const H = 3600;

async function item(
    id: string,
    over: {
        type?: 'task' | 'sub_task';
        project?: string;
        status: string;
        created: string;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        parent?: string;
        is_test?: boolean;
    },
): Promise<void> {
    await insertItem({
        id,
        type: over.type ?? 'task',
        project_id: over.project ?? 'p1',
        status: over.status,
        priority: over.priority ?? 'normal',
        ...(over.parent ? { parent_id: over.parent, parent_type: 'task' as const } : {}),
    });
    await testDb
        .updateTable('items')
        .set({ created_at: over.created, is_test: over.is_test ?? false } as never)
        .where('id', '=', id)
        .execute();
}

/** A status path: [from, to, at] triples, in order. */
async function moves(id: string, path: Array<[string, string, string]>): Promise<void> {
    for (const [from, to, at] of path) {
        await testDb
            .insertInto('issue_events')
            .values({ item_id: id, event_type: 'status_changed', field: 'status', from_value: from, to_value: to, created_at: at } as never)
            .execute();
    }
}

async function seed(): Promise<void> {
    await insertProject('p1', 'ATL');
    await insertProject('p2', 'JRA');

    // A — high. lead 10h, cycle 8h (first In progress 02:00 → Done 10:00).
    // draft 1h, ready 1h, in_progress 2h+2h, waiting 2h, in_review 2h.
    await item('A', { status: 'done', created: '2026-10-11T00:00:00Z', priority: 'high' });
    await moves('A', [
        ['draft', 'ready', '2026-10-11T01:00:00Z'],
        ['ready', 'in_progress', '2026-10-11T02:00:00Z'],
        ['in_progress', 'waiting_for_info', '2026-10-11T04:00:00Z'],
        ['waiting_for_info', 'in_progress', '2026-10-11T06:00:00Z'],
        ['in_progress', 'in_review', '2026-10-11T08:00:00Z'],
        ['in_review', 'done', '2026-10-11T10:00:00Z'],
    ]);
    // S1 — A's sub-task, shipped Oct 11 14:30 IST.
    await item('S1', { type: 'sub_task', parent: 'A', status: 'done', created: '2026-10-11T00:00:00Z' });
    await moves('S1', [['draft', 'done', '2026-10-11T09:00:00Z']]);

    // B — lead 5h, cycle 4h. draft 1h, in_progress 4h.
    await item('B', { status: 'done', created: '2026-10-12T00:00:00Z' });
    await moves('B', [
        ['draft', 'in_progress', '2026-10-12T01:00:00Z'],
        ['in_progress', 'done', '2026-10-12T05:00:00Z'],
    ]);

    // C — Jira-sourced, p2. Straight to Done (no cycle time), lead 20h, all of
    // it draft. Done at 20:00Z = Oct 15 01:30 IST, so it buckets on Oct 15
    // here and on Oct 14 in UTC. Then reopened and in progress again → WIP,
    // aged from the reopen's In progress (Oct 15 00:00Z): 30.5h.
    await item('C', { project: 'p2', status: 'in_progress', created: '2026-10-14T00:00:00Z' });
    await moves('C', [
        ['draft', 'done', '2026-10-14T20:00:00Z'],
        ['done', 'in_progress', '2026-10-15T00:00:00Z'],
    ]);
    await testDb
        .insertInto('item_external_links')
        .values({ item_id: 'C', link_kind: 'jira_issue', url: 'https://x.atlassian.net/browse/J-1' } as never)
        .execute();

    // E — Done at exactly the window start (inclusive). lead 30m, cycle 20m.
    await item('E', { status: 'done', created: '2026-10-09T18:00:00Z' });
    await moves('E', [
        ['draft', 'in_progress', '2026-10-09T18:10:00Z'],
        ['in_progress', 'done', '2026-10-09T18:30:00Z'],
    ]);

    // D — one minute before the window: the previous window's only ship.
    // cycle = 10:00Z → 18:29Z = 8h29m = 30540s.
    await item('D', { status: 'done', created: '2026-10-09T00:00:00Z' });
    await moves('D', [
        ['draft', 'in_progress', '2026-10-09T10:00:00Z'],
        ['in_progress', 'done', '2026-10-09T18:29:00Z'],
    ]);

    // F — waiting for you since 00:30Z today: an open park, 6h to now. WIP, aged 18.5h.
    await item('F', { status: 'waiting_for_info', created: '2026-10-15T00:00:00Z' });
    await moves('F', [
        ['draft', 'in_progress', '2026-10-15T12:00:00Z'],
        ['in_progress', 'waiting_for_info', '2026-10-16T00:30:00Z'],
    ]);

    // W — in progress since Oct 1: aging WIP (15d 6.5h).
    await item('W', { status: 'in_progress', created: '2026-09-30T00:00:00Z' });
    await moves('W', [['draft', 'in_progress', '2026-10-01T00:00:00Z']]);

    // T — an agent test's item: shipped in the window, counted nowhere.
    await item('T', { status: 'done', created: '2026-10-11T00:00:00Z', is_test: true });
    await moves('T', [
        ['draft', 'in_progress', '2026-10-11T00:00:00Z'],
        ['in_progress', 'waiting_for_info', '2026-10-11T00:10:00Z'],
        ['waiting_for_info', 'done', '2026-10-11T00:20:00Z'],
    ]);
}

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('percentileCont', () => {
    it('interpolates like Postgres percentile_cont', () => {
        expect(percentileCont([], 0.5)).toBeNull();
        expect(percentileCont([5], 0.9)).toBe(5);
        expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(percentileCont([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 10);
    });
});

describe('resolveWindow', () => {
    it('resolves each window in the viewer tz', async () => {
        const w7 = await resolveWindow(TZ, '7d', NOW);
        expect(w7).toMatchObject({
            bucket: 'day',
            start: '2026-10-09T18:30:00.000Z',
            end: '2026-10-16T06:30:00.000Z',
            previous_start: '2026-10-02T18:30:00.000Z',
            previous_end: '2026-10-09T18:30:00.000Z',
        });
        // month = Oct 1 IST so far; previous = the same 15.5 days into September.
        expect(await resolveWindow(TZ, 'month', NOW)).toMatchObject({
            start: '2026-09-30T18:30:00.000Z',
            previous_start: '2026-08-31T18:30:00.000Z',
            previous_end: '2026-09-16T06:30:00.000Z',
        });
        expect((await resolveWindow(TZ, '90d', NOW)).bucket).toBe('week');
        expect((await resolveWindow('UTC', '30d', NOW)).start).toBe('2026-09-17T00:00:00.000Z');
    });

    it('clamps the previous month span to that month (Mar 31 → Feb 28)', async () => {
        const w = await resolveWindow('UTC', 'month', new Date('2027-03-31T12:00:00Z'));
        expect(w.previous_end).toBe('2027-02-28T12:00:00.000Z');
    });
});

describe('deliveryAnalytics', () => {
    it('answers an empty workspace with zeros, nulls and zero-filled buckets', async () => {
        const d = await deliveryAnalytics({ tz: TZ, window: '7d', now: NOW });
        expect(d.shipped).toEqual({ tasks: 0, sub_tasks: 0 });
        expect(d.throughput).toHaveLength(7);
        expect(d.throughput.every((b) => b.tasks === 0 && b.cycle_p50_s === null)).toBe(true);
        expect(d.lead_time).toEqual({ count: 0, p50_s: null, p90_s: null });
        expect(d.cycle_time).toEqual({ count: 0, p50_s: null, p90_s: null });
        expect(d.time_in_status.every((s) => s.avg_s === 0)).toBe(true);
        expect(d.waiting).toEqual({ parks: 0, total_s: 0, median_s: null, still_waiting: 0 });
        expect(d.reopens).toEqual({ reopened: 0, done: 0, rate: null });
        expect(d.wip).toMatchObject({ count: 0, aging: 0, oldest: [] });
        expect(d.prs).toEqual({ opened: 0, merged: 0, merge_rate: null, median_s_to_pr: null });
        expect(d.previous).toEqual({ tasks_shipped: 0, cycle_p50_s: null, prs_merged: 0 });
    });

    it('computes every delivery number from the status history', async () => {
        await seed();
        const d = await deliveryAnalytics({ tz: TZ, window: '7d', now: NOW });

        // A, B, C, E shipped (D is before the window, T is a test); S1 the sub-task.
        expect(d.shipped).toEqual({ tasks: 4, sub_tasks: 1 });

        // Cycle [E 1200, B 14400, A 28800] (C has none): p50 14400,
        // p90 = 14400 + 0.8 × 14400 = 25920.
        expect(d.cycle_time).toEqual({ count: 3, p50_s: 14400, p90_s: 25920 });
        // Lead [E 1800, B 18000, A 36000, C 72000]: p50 27000, p90 36000 + 0.7 × 36000.
        expect(d.lead_time.count).toBe(4);
        expect(d.lead_time.p50_s).toBe(27000);
        expect(d.lead_time.p90_s).toBeCloseTo(61200, 6);

        const hist = Object.fromEntries(d.cycle_histogram.map((h) => [h.label, h.count]));
        expect(hist).toMatchObject({ '< 1h': 1, '1–4h': 0, '4–24h': 2, '> 2w': 0 });

        // Local-day buckets: E Oct 10 00:00 IST, A + S1 Oct 11, B Oct 12, C Oct 15.
        const tp = Object.fromEntries(d.throughput.map((b) => [b.bucket, b]));
        expect(d.throughput.map((b) => b.bucket)).toEqual([
            '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
        ]);
        expect(tp['2026-10-10']).toEqual({ bucket: '2026-10-10', tasks: 1, sub_tasks: 0, cycle_p50_s: 1200 });
        expect(tp['2026-10-11']).toEqual({ bucket: '2026-10-11', tasks: 1, sub_tasks: 1, cycle_p50_s: 28800 });
        expect(tp['2026-10-15']).toMatchObject({ tasks: 1, cycle_p50_s: null });
        expect(tp['2026-10-14']?.tasks).toBe(0);

        // Totals ÷ 4 shipped Tasks: draft (1h+1h+20h+10m) = 79800 → 19950;
        // ready 1h → 900; in_progress (4h+4h+20m) → 7500; waiting 2h → 1800; review 2h → 1800.
        const tis = Object.fromEntries(d.time_in_status.map((s) => [s.status, s]));
        expect(tis['draft']).toEqual({ status: 'draft', avg_s: 19950, items: 4 });
        expect(tis['ready']).toEqual({ status: 'ready', avg_s: 900, items: 1 });
        expect(tis['in_progress']).toEqual({ status: 'in_progress', avg_s: 7500, items: 3 });
        expect(tis['waiting_for_info']).toEqual({ status: 'waiting_for_info', avg_s: 1800, items: 1 });
        expect(tis['in_review']).toEqual({ status: 'in_review', avg_s: 1800, items: 1 });

        // A's 2h park plus F's open one (6h to now). T's is a test's.
        expect(d.waiting).toEqual({ parks: 2, total_s: 8 * H, median_s: 4 * H, still_waiting: 1 });

        // C left Done; A, B, C, E, S1 entered it.
        expect(d.reopens).toEqual({ reopened: 1, done: 5, rate: 0.2 });

        // W (15d 6.5h), C (30.5h from its reopen), F (18.5h). Only W is past 7 days.
        expect(d.wip.count).toBe(3);
        expect(d.wip.aging).toBe(1);
        expect(d.wip.oldest.map((w) => [w.id, w.age_s])).toEqual([
            ['W', 15 * 86_400 + 6.5 * H],
            ['C', 30.5 * H],
            ['F', 18.5 * H],
        ]);

        const pri = Object.fromEntries(d.by_priority.map((p) => [p.priority, p]));
        expect(pri['high']).toEqual({ priority: 'high', shipped: 1, cycle_p50_s: 28800 });
        // normal: B 14400, E 1200 (C none) → 7800.
        expect(pri['normal']).toEqual({ priority: 'normal', shipped: 3, cycle_p50_s: 7800 });
        expect(pri['urgent']).toEqual({ priority: 'urgent', shipped: 0, cycle_p50_s: null });

        expect(d.by_project).toEqual([
            { project_id: 'p1', project_name: 'Project p1', shipped: 3, cycle_p50_s: 14400, lead_p50_s: 18000 },
            { project_id: 'p2', project_name: 'Project p2', shipped: 1, cycle_p50_s: null, lead_p50_s: 72000 },
        ]);
        expect(d.source_mix).toEqual({ jira: 1, native: 3 });
        expect(d.previous).toEqual({ tasks_shipped: 1, cycle_p50_s: 30540, prs_merged: 0 });
    });

    it('buckets by the viewer tz: the same Done lands a day earlier in UTC', async () => {
        await seed();
        const d = await deliveryAnalytics({ tz: 'UTC', window: '7d', now: NOW });
        // UTC window starts Oct 10 00:00Z, so E (Oct 9 18:30Z) is out.
        expect(d.shipped.tasks).toBe(3);
        expect(d.throughput.find((b) => b.bucket === '2026-10-14')?.tasks).toBe(1);
        expect(d.throughput.find((b) => b.bucket === '2026-10-15')?.tasks).toBe(0);
    });

    it('rolls 90 days into Monday weeks', async () => {
        await seed();
        const d = await deliveryAnalytics({ tz: TZ, window: '90d', now: NOW });
        expect(d.period.bucket).toBe('week');
        // Oct 12 is a Monday: D (Fri), E (Sat) and A (Sun) are the week of
        // Oct 5; B and C the week of Oct 12.
        const wk = Object.fromEntries(d.throughput.map((b) => [b.bucket, b.tasks]));
        expect(wk['2026-10-05']).toBe(3);
        expect(wk['2026-10-12']).toBe(2);
        expect(d.shipped.tasks).toBe(5);
    });

    it('counts shipped Tasks the same way for the Spend tab', async () => {
        await seed();
        expect(await countShippedTasks('2026-10-09T18:30:00Z', NOW.toISOString())).toBe(4);
    });
});
