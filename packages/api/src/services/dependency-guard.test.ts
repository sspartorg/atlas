import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    assertDepsAllDoneForDispatch,
    assertNoOpenBlockers,
    notifyDependentsUnblocked,
    DependenciesNotReadyError,
} from './dependency-guard.js';
import { itemLinks } from './item-links.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('assertDepsAllDoneForDispatch', () => {
    it('returns silently when item has no depends_on links', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
        // No deps at all — should not throw
        await expect(assertDepsAllDoneForDispatch('ATL-1', 'agent-coder')).resolves.toBeUndefined();
    });

    it('returns silently when all depends_on targets are done', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'done' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        // Upstream is done, so no blockers — should not throw
        await expect(assertDepsAllDoneForDispatch('ATL-2', 'agent-coder')).resolves.toBeUndefined();
    });

    it('throws DependenciesNotReadyError when one dep is not done', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'in_progress' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        await expect(
            assertDepsAllDoneForDispatch('ATL-2', 'agent-coder'),
        ).rejects.toThrow(DependenciesNotReadyError);
    });

    it('DependenciesNotReadyError carries the blockers array', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'in_review' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        let caught: DependenciesNotReadyError | undefined;
        try {
            await assertDepsAllDoneForDispatch('ATL-2', 'agent-coder');
        } catch (err) {
            caught = err as DependenciesNotReadyError;
        }
        expect(caught).toBeInstanceOf(DependenciesNotReadyError);
        expect(caught!.blockers).toHaveLength(1);
        expect(caught!.blockers[0]!.id).toBe('ATL-1');
        expect(caught!.blockers[0]!.status).toBe('in_review');
        expect(caught!.name).toBe('DependenciesNotReadyError');
    });

    it('records a dispatch_blocked event on the item when blocked', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'draft' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        try {
            await assertDepsAllDoneForDispatch('ATL-2', 'agent-coder');
        } catch {
            // Expected throw
        }

        const events = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-2')
            .where('event_type', '=', 'dispatch_blocked')
            .execute();
        expect(events).toHaveLength(1);
        expect(events[0]!.actor_agent_id).toBe('agent-coder');
    });

    it('handles multiple blockers — error message lists all', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Up1', status: 'draft' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Up2', status: 'in_progress' });
        await insertItem({ id: 'ATL-3', type: 'epic', project_id: 'p1', title: 'Down', status: 'draft' });
        await itemLinks.create('ATL-3', 'ATL-1', 'depends_on');
        await itemLinks.create('ATL-3', 'ATL-2', 'depends_on');

        let caught: DependenciesNotReadyError | undefined;
        try {
            await assertDepsAllDoneForDispatch('ATL-3', 'agent-coder');
        } catch (err) {
            caught = err as DependenciesNotReadyError;
        }
        expect(caught).toBeInstanceOf(DependenciesNotReadyError);
        expect(caught!.blockers).toHaveLength(2);
        // Error message should mention both
        expect(caught!.message).toMatch(/ATL-1/);
        expect(caught!.message).toMatch(/ATL-2/);
    });
});

describe('assertNoOpenBlockers', () => {
    it('returns silently when transitioning to waiting_for_info regardless of blockers', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'in_progress' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        // waiting_for_info is always allowed
        await expect(assertNoOpenBlockers('ATL-2', 'waiting_for_info')).resolves.toBeUndefined();
    });

    it('returns silently when transitioning to draft (not a work-start status)', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'in_progress' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        // draft is not gated
        await expect(assertNoOpenBlockers('ATL-2', 'draft')).resolves.toBeUndefined();
    });

    it('throws when transitioning to in_progress with open blockers', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'draft' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const err = await assertNoOpenBlockers('ATL-2', 'in_progress').catch((e) => e) as Error & { code?: string };
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('blocked');
    });

    it('throws when transitioning to in_review with open blockers', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'draft' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        await expect(assertNoOpenBlockers('ATL-2', 'in_review')).rejects.toThrow(/Blocked by/);
    });

    it('passes when blockers are all done and transitioning to in_progress', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'done' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        await expect(assertNoOpenBlockers('ATL-2', 'in_progress')).resolves.toBeUndefined();
    });
});

describe('notifyDependentsUnblocked', () => {
    it('returns empty array when item has no dependents', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Leaf', status: 'done' });
        const unblocked = await notifyDependentsUnblocked('ATL-1');
        expect(unblocked).toEqual([]);
    });

    it('returns the dependent id and emits an unblocked event when last blocker resolves', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Upstream', status: 'done' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'ready' });
        await itemLinks.create('ATL-2', 'ATL-1', 'depends_on');

        const unblocked = await notifyDependentsUnblocked('ATL-1');
        expect(unblocked).toContain('ATL-2');

        const events = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-2')
            .where('event_type', '=', 'unblocked')
            .execute();
        expect(events).toHaveLength(1);
        expect(events[0]!.detail).toMatch(/ATL-1/);
    });

    it('does NOT emit unblocked when a second blocker is still open', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'Up1 (done)', status: 'done' });
        await insertItem({ id: 'ATL-2', type: 'epic', project_id: 'p1', title: 'Up2 (still open)', status: 'draft' });
        await insertItem({ id: 'ATL-3', type: 'epic', project_id: 'p1', title: 'Downstream', status: 'draft' });
        await itemLinks.create('ATL-3', 'ATL-1', 'depends_on');
        await itemLinks.create('ATL-3', 'ATL-2', 'depends_on');

        // ATL-1 just went to done, but ATL-2 is still open
        const unblocked = await notifyDependentsUnblocked('ATL-1');
        expect(unblocked).not.toContain('ATL-3');

        const events = await testDb
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', 'ATL-3')
            .where('event_type', '=', 'unblocked')
            .execute();
        expect(events).toHaveLength(0);
    });
});
