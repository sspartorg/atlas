import { describe, expect, it, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { maybeAutoDispatch, findLiveRunOnItem } from './agent-dispatcher.js';
import { itemLinks } from './item-links.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

// B04 — DB-backed integration tests for the pre-dispatch depends_on gate.
// These complement the pure-unit `agent-dispatcher.test.ts` which only covers
// `shouldAutoDispatch`. Here we exercise the end-to-end `maybeAutoDispatch`
// path, including the gate inside spawnAgentRun and the dispatcher's catch
// that turns `DependenciesNotReadyError` into the typed skip reason.
//
// Fake timers keep the simulated CLI from firing after the test completes —
// the runner schedules a 400ms setTimeout in simulated mode (ATLAS_AI_ENABLED
// unset) which would otherwise leak across tests.

beforeEach(async () => {
    vi.useFakeTimers();
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    // Stories need an epic parent per the items CHECK constraint.
    await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Parent epic' });
    // Downstream item — `ready` + assigned, so the dispatcher's earlier
    // preconditions all pass and we get to spawnAgentRun.
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-100',
        parent_type: 'epic',
        title: 'Downstream',
        status: 'ready',
        assignee_agent_id: 'agent-coder',
    });
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(async () => {
    await closeTestDb();
});

describe('maybeAutoDispatch — depends_on gate (B04)', () => {
    it('refuses to dispatch when a depends_on target is in_progress', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream',
            status: 'in_progress',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const result = await maybeAutoDispatch('ATL-2');

        expect(result.dispatched).toBe(false);
        if (result.dispatched) throw new Error('unreachable');
        expect(result.reason).toBe('deps_blocked');
        if (result.reason !== 'deps_blocked') throw new Error('unreachable');
        expect(result.blockers).toEqual([
            expect.objectContaining({ id: 'ATL-1', status: 'in_progress' }),
        ]);

        // Activity event was recorded.
        const events = await eventsLog.list('ATL-2', 'story');
        expect(events.some((e) => e.event_type === 'dispatch_blocked')).toBe(true);
    });

    it('refuses to dispatch when a depends_on target is in_review (in_review is NOT terminal)', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream in review',
            status: 'in_review',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const result = await maybeAutoDispatch('ATL-2');

        expect(result.dispatched).toBe(false);
        if (result.dispatched) throw new Error('unreachable');
        expect(result.reason).toBe('deps_blocked');
        if (result.reason !== 'deps_blocked') throw new Error('unreachable');
        expect(result.blockers).toEqual([
            expect.objectContaining({ id: 'ATL-1', status: 'in_review' }),
        ]);
    });

    it('dispatches when every depends_on target is done', async () => {
        await insertItem({
            id: 'ATL-1',
            type: 'story',
            project_id: 'p1',
            parent_id: 'ATL-100',
            parent_type: 'epic',
            title: 'Upstream done',
            status: 'done',
        });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const result = await maybeAutoDispatch('ATL-2');

        expect(result.dispatched).toBe(true);
        if (!result.dispatched) throw new Error('unreachable');
        expect(typeof result.runId).toBe('string');

        // No dispatch_blocked event for the successful path.
        const events = await eventsLog.list('ATL-2', 'story');
        expect(events.some((e) => e.event_type === 'dispatch_blocked')).toBe(false);
    });

    it('dispatches when an item has no depends_on links at all', async () => {
        // Baseline sanity: a clean item with no upstreams works.
        const result = await maybeAutoDispatch('ATL-2');
        expect(result.dispatched).toBe(true);
    });
});

// 2026-06-10 — Item-level run lock: ANY in_progress run on an item
// must block ANY new dispatch on that item, regardless of agent id.
// Pre-fix the check was scoped per `(item, agent)`, which let the
// successor agent start while the predecessor was still finalising
// (cleanup, push). MON-3 forensic in plan file.
describe('maybeAutoDispatch — item-level run lock (cross-agent block)', () => {
    it('refuses to dispatch when a DIFFERENT agent has an in_progress run on the same item', async () => {
        // The new assignee is agent-coder (set in beforeEach). Simulate
        // a previous agent (`agent-automation`) still running on the
        // same item — the kind of overlap that triggered the MON-3 race.
        await insertAgent({ id: 'agent-automation', status: 'active' });
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'prior-run-id',
                agent_id: 'agent-automation',
                item_id: 'ATL-2',
                status: 'in_progress',
                started_at: new Date().toISOString(),
            })
            .execute();

        const result = await maybeAutoDispatch('ATL-2');

        expect(result.dispatched).toBe(false);
        if (result.dispatched) throw new Error('unreachable');
        expect(result.reason).toBe('live_run_exists');
    });

    it('findLiveRunOnItem returns the active run regardless of which agent owns it', async () => {
        await insertAgent({ id: 'agent-automation', status: 'active' });
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'prior-run-id-2',
                agent_id: 'agent-automation',
                item_id: 'ATL-2',
                status: 'in_progress',
                started_at: new Date().toISOString(),
            })
            .execute();

        const blocker = await findLiveRunOnItem('ATL-2');
        expect(blocker).toEqual({ runId: 'prior-run-id-2', agentId: 'agent-automation' });
    });

    it('findLiveRunOnItem returns null when no live run exists on the item', async () => {
        const blocker = await findLiveRunOnItem('ATL-2');
        expect(blocker).toBeNull();
    });

    it('findLiveRunOnItem ignores completed/error runs (only counts queued/in_progress)', async () => {
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'completed-run',
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                status: 'completed',
                started_at: new Date(Date.now() - 60_000).toISOString(),
                completed_at: new Date().toISOString(),
            })
            .execute();
        const blocker = await findLiveRunOnItem('ATL-2');
        expect(blocker).toBeNull();
    });
});

describe('agent_runs unique partial index (race-free DB invariant)', () => {
    it('rejects a second concurrent in_progress row for the same item', async () => {
        await insertAgent({ id: 'agent-automation', status: 'active' });
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'first-run',
                agent_id: 'agent-automation',
                item_id: 'ATL-2',
                status: 'in_progress',
                started_at: new Date().toISOString(),
            })
            .execute();

        await expect(
            testDb
                .insertInto('agent_runs')
                .values({
                    id: 'second-run',
                    agent_id: 'agent-coder',
                    item_id: 'ATL-2',
                    status: 'queued',
                    started_at: new Date().toISOString(),
                })
                .execute(),
        ).rejects.toThrow(); // SQLSTATE 23505
    });

    it('allows a second insert once the first row flips to completed', async () => {
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'first-run-2',
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                status: 'completed',
                started_at: new Date(Date.now() - 60_000).toISOString(),
                completed_at: new Date().toISOString(),
            })
            .execute();

        // Should succeed — the index excludes completed/error/cancelled.
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'second-run-2',
                agent_id: 'agent-coder',
                item_id: 'ATL-2',
                status: 'queued',
                started_at: new Date().toISOString(),
            })
            .execute();

        const blocker = await findLiveRunOnItem('ATL-2');
        expect(blocker?.runId).toBe('second-run-2');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2026-09-12 — the run-promotion guard in `agent-runner.ts`.
//
// `spawnAgentRun` flips a run queued → in_progress from a 200ms
// `setTimeout`. The flip used to be unconditional, which is safe only if the
// row is still the item's live run when the timer fires. It often isn't: the
// Owner cancels, `failOrphanedRuns` sweeps it, or the item is deleted — and by
// then a replacement run can hold the slot. The unconditional flip then put
// the stale row BACK into the live set and tripped
// `agent_runs_one_live_per_item`, surfacing only as
// "unhandled promise rejection (kept alive)" in the API log while the run
// silently never started.
//
// This asserts both halves against the real index: the old shape raises 23505,
// the guarded shape no-ops. Anyone tempted to drop the `.where('status', '=',
// 'queued')` as redundant should read this first.
// ──────────────────────────────────────────────────────────────────────────────

describe('agent_runs live-run invariant — queued → in_progress promotion', () => {
    // Run A is superseded: it leaves the live set, B takes the item's slot,
    // and A's timer fires afterwards.
    async function supersededRun() {
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-a', agent_id: 'agent-coder', item_id: 'ATL-2', status: 'queued' })
            .execute();
        await testDb
            .updateTable('agent_runs')
            .set({ status: 'error' })
            .where('id', '=', 'run-a')
            .execute();
        await testDb
            .insertInto('agent_runs')
            .values({ id: 'run-b', agent_id: 'agent-coder', item_id: 'ATL-2', status: 'queued' })
            .execute();
    }

    it('the old unconditional flip violates the one-live-per-item index', async () => {
        await supersededRun();
        await expect(
            testDb
                .updateTable('agent_runs')
                .set({ status: 'in_progress' })
                .where('id', '=', 'run-a')
                .execute(),
        ).rejects.toThrow(/agent_runs_one_live_per_item/);
    });

    it('the guarded flip updates nothing and does not throw', async () => {
        await supersededRun();
        const res = await testDb
            .updateTable('agent_runs')
            .set({ status: 'in_progress' })
            .where('id', '=', 'run-a')
            .where('status', '=', 'queued')
            .executeTakeFirst();
        expect(Number(res.numUpdatedRows ?? 0)).toBe(0);

        // run-b keeps the slot; run-a stays out of the live set.
        const rows = await testDb
            .selectFrom('agent_runs')
            .select(['id', 'status'])
            .orderBy('id', 'asc')
            .execute();
        expect(rows).toEqual([
            { id: 'run-a', status: 'error' },
            { id: 'run-b', status: 'queued' },
        ]);
    });
});
