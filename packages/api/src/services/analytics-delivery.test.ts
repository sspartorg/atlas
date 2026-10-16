import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { deliveryAnalytics, countShippedTasks, percentileCont } from './analytics-delivery.js';
import { resolveWindow } from './analytics-window.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

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

        // Flow over the shipped Tasks' status time: worked = In progress
        // (A 4h + B 4h + E 20m = 30000) + In review (A 2h) = 37200 of 127800.
        expect(d.flow.active_s).toBe(37200);
        expect(d.flow.waiting_s).toBe(90600);
        expect(d.flow.efficiency).toBeCloseTo(37200 / 127800, 12);
        // 4 Tasks over 6.5 days of window = 56/13 a week. Weeks: E, A (Oct 5) and B, C (Oct 12).
        expect(d.flow.weekly_throughput).toBeCloseTo(56 / 13, 12);
        expect(d.flow.weekly).toEqual([
            { bucket: '2026-10-05', tasks: 2 },
            { bucket: '2026-10-12', tasks: 2 },
        ]);
        // No workflow runs in this fixture.
        expect(d.flow.owner_response).toEqual({ answered: 0, unanswered: 0, p50_s: null, p90_s: null });
        expect(d.first_attempt).toEqual({ merged_runs: 0, clean: 0, rate: null });
        // C left Done (Oct 15) after its first Done (Oct 14): 1 of 4.
        expect(d.rework).toEqual({ shipped: 4, reopened: 1, rate: 0.25 });

        // Trends: this window, the previous one (D alone), and each local day.
        expect(d.buckets).toEqual(d.throughput.map((b) => b.bucket));
        expect(d.trends.tasks_shipped).toEqual({ cur: 4, prev: 1, series: [1, 1, 1, 0, 0, 1, 0] });
        expect(d.trends.cycle_p50_s).toEqual({ cur: 14400, prev: 30540, series: [1200, 28800, 14400, null, null, null, null] });
        expect(d.trends.lead_p50_s).toEqual({ cur: 27000, prev: 66540, series: [1800, 36000, 18000, null, null, 72000, null] });
        // E 1200/1800, A 21600/36000, B 14400/18000, C 0/72000; D 30540/66540 before.
        expect(d.trends.flow_efficiency.series).toEqual([1200 / 1800, 0.6, 0.8, null, null, 0, null]);
        expect(d.trends.flow_efficiency.prev).toBeCloseTo(30540 / 66540, 12);
        expect(d.trends.rework_rate).toEqual({ cur: 0.25, prev: 0, series: [0, 0, 0, null, null, 1, null] });
        // A's park (Oct 11 IST) and F's open one (Oct 16 IST).
        expect(d.trends.waiting_s).toEqual({ cur: 8 * H, prev: null, series: [null, 2 * H, null, null, null, null, 6 * H] });
        // Out of Done: C (Oct 15 IST). Into Done: E; A + S1; B; C (Oct 15 01:30 IST).
        expect(d.trends.reopen_rate).toEqual({ cur: 0.2, prev: 0, series: [0, 0, 0, null, null, 1, null] });
        // WIP replayed at each local day's end: W alone until C and F move in on
        // Oct 15. At the previous window's end (= this one's start) only W was open.
        expect(d.trends.wip).toEqual({ cur: 3, prev: 1, series: [1, 1, 1, 1, 1, 3, 3] });
        expect(d.trends.weekly_throughput.cur).toBeCloseTo(56 / 13, 12);
        expect(d.trends.weekly_throughput.prev).toBe(1);
        expect(d.trends.weekly_throughput.series).toEqual([2, 2, 2, 2, 2, 2, 2]);
        expect(d.trends.prs_merged).toEqual({ cur: 0, prev: 0, series: [0, 0, 0, 0, 0, 0, 0] });
        expect(d.trends.first_attempt_merge_rate.cur).toBeNull();
    });

    it('measures the Owner response to parks and first-attempt merges from workflow runs', async () => {
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-coder', status: 'active' });
        await testDb
            .insertInto('workflows')
            .values({ id: 'wf', project_id: 'p1', name: 'Delivery', graph: JSON.stringify({ nodes: [], edges: [] }), input_kind: 'item', trigger: 'manual' } as never)
            .execute();
        for (const id of ['X', 'Y', 'Z', 'Q', 'P']) await item(id, { status: 'in_progress', created: '2026-10-01T00:00:00Z' });
        await item('TT', { status: 'in_progress', created: '2026-10-01T00:00:00Z', is_test: true });
        let n = 0;
        const run = async (id: string, started: string, itemId: string | null, prs: string[] = [], parent?: string) => {
            await testDb
                .insertInto('workflow_runs')
                .values({
                    id, workflow_id: 'wf', project_id: 'p1', item_id: itemId, status: 'completed',
                    graph_snapshot: JSON.stringify({ nodes: [], edges: [] }), started_at: started,
                    pr_urls: JSON.stringify(prs), ...(parent ? { parent_workflow_run_id: parent } : {}),
                } as never)
                .execute();
        };
        const ev = async (runId: string, kind: 'parked' | 'resumed', at: string, parkKind = 'question') => {
            await testDb
                .insertInto('workflow_run_events')
                .values({ id: `ev-${++n}`, workflow_run_id: runId, kind, park_kind: kind === 'parked' ? parkKind : null, created_at: at } as never)
                .execute();
        };
        const pr = async (itemId: string, url: string, state: string, at: string) => {
            await testDb
                .insertInto('item_external_links')
                .values({ item_id: itemId, link_kind: 'pull_request', url, pr_state: state, created_at: at } as never)
                .execute();
        };

        // wr1 (X): one PR, merged, but its tree parked; wr2 (Y): two PRs, both
        // merged, nothing retried or parked; wr3 (Z): its PR still open; wr4
        // (Q): merged after a retried step. wr0 is last week's run.
        await run('wr1', '2026-10-11T00:00:00Z', 'X', ['u1']);
        await run('cr1', '2026-10-13T23:00:00Z', null, [], 'wr1');
        await run('wr2', '2026-10-13T00:00:00Z', 'Y', ['u2', 'u3']);
        await run('wr3', '2026-10-14T00:00:00Z', 'Z', ['u4']);
        await run('wr4', '2026-10-14T06:00:00Z', 'Q', ['u5']);
        await run('wt', '2026-10-12T00:00:00Z', 'TT');
        await run('wr0', '2026-10-05T00:00:00Z', 'P');
        await pr('X', 'u1', 'merged', '2026-10-11T01:00:00Z');
        await pr('Y', 'u2', 'merged', '2026-10-13T02:00:00Z');
        await pr('Y', 'u3', 'merged', '2026-10-13T03:00:00Z');
        await pr('Z', 'u4', 'open', '2026-10-14T03:00:00Z');
        await pr('Q', 'u5', 'merged', '2026-10-14T10:00:00Z');
        const step = async (id: string, runId: string, parent?: string) => {
            await testDb
                .insertInto('agent_runs')
                .values({
                    id, agent_id: 'agent-coder', project_id: 'p1', status: 'completed', workflow_run_id: runId, node_id: 'n',
                    outcome_kind: 'done', total_cost_usd: 1, created_at: '2026-10-14T07:00:00Z',
                    ...(parent ? { parent_run_id: parent } : {}),
                } as never)
                .execute();
        };
        await step('s1', 'wr4');
        await step('s2', 'wr4', 's1');

        // Parks (UTC days): wr1 answered in 2h (Oct 12) and 6h (Oct 13); the
        // sub-task run answered in 1h (Oct 14), its Task's copy skipped; wr1's
        // Oct 15 park still open. The test's park and last week's 4h are out / previous.
        await ev('wr1', 'parked', '2026-10-12T00:00:00Z');
        await ev('wr1', 'resumed', '2026-10-12T02:00:00Z');
        await ev('wr1', 'parked', '2026-10-13T00:00:00Z');
        await ev('wr1', 'resumed', '2026-10-13T06:00:00Z');
        await ev('cr1', 'parked', '2026-10-14T00:00:00Z');
        await ev('wr1', 'parked', '2026-10-14T00:00:00Z', 'subtask_waiting');
        await ev('cr1', 'resumed', '2026-10-14T01:00:00Z');
        await ev('wr1', 'resumed', '2026-10-14T01:00:01Z');
        await ev('wr1', 'parked', '2026-10-15T00:00:00Z');
        await ev('wt', 'parked', '2026-10-12T00:00:00Z');
        await ev('wt', 'resumed', '2026-10-12T00:00:05Z');
        await ev('wr0', 'parked', '2026-10-05T00:00:00Z');
        await ev('wr0', 'resumed', '2026-10-05T04:00:00Z');

        const d = await deliveryAnalytics({ tz: 'UTC', window: '7d', now: NOW });

        // Answered [1h, 2h, 6h]: p50 2h, p90 = 2h + 0.8 × 4h.
        expect(d.flow.owner_response).toEqual({ answered: 3, unanswered: 1, p50_s: 2 * H, p90_s: 18720 });
        expect(d.trends.owner_response_p50_s).toEqual({ cur: 2 * H, prev: 4 * H, series: [null, null, 2 * H, 6 * H, H, null, null] });

        // Merged: wr1 (parked), wr2 (clean), wr4 (retried) → 1 of 3.
        expect(d.first_attempt).toEqual({ merged_runs: 3, clean: 1, rate: 1 / 3 });
        expect(d.trends.first_attempt_merge_rate.series).toEqual([null, 0, null, 1, 0, null, null]);
        expect(d.prs).toEqual({ opened: 5, merged: 4, merge_rate: 0.8, median_s_to_pr: 7200 });
        expect(d.trends.prs_merged).toEqual({ cur: 4, prev: 0, series: [0, 1, 0, 2, 1, 0, 0] });
        // Run start → first PR: 1h, 2h, 3h, 4h; the nearest-rank median is 2h, as on the fleet page
        // (Oct 14 holds 3h and 4h: nearest rank takes the lower).
        expect(d.trends.time_to_pr_s).toEqual({ cur: 7200, prev: null, series: [null, 3600, null, 7200, 3 * H, null, null] });
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
