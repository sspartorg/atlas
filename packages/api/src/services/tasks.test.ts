import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => {
    // Mirror the real `logFieldUpdates` closely enough that tests asserting
    // on `eventsLog.record` calls keep working after Theme 05's expansion.
    const FIELD_MAP: Record<string, string> = {
        title: 'title', description: 'description', spec_md: 'spec_md',
        pr_url: 'pr_url', acceptance_criteria: 'acceptance_criteria',
        priority: 'priority', reporter_agent_id: 'reporter',
    };
    const eventsLog = {
        record: vi.fn(),
        activity: vi.fn().mockResolvedValue([]),
        logFieldUpdates: vi.fn(async (
            issueType: string,
            id: string,
            before: Record<string, unknown>,
            data: Record<string, unknown>,
            allowed: string[],
        ) => {
            const allowedSet = new Set(allowed);
            for (const k of Object.keys(data)) {
                if (data[k] === undefined) continue;
                const field = FIELD_MAP[k];
                if (!field || !allowedSet.has(field)) continue;
                const beforeKey = k in before ? k : field;
                if (before[beforeKey] === data[k]) continue;
                await eventsLog.record({
                    item_id: id,
                    item_type: issueType,
                    event_type: 'field_updated',
                    field,
                    from_value: before[beforeKey] == null ? null : String(before[beforeKey]),
                    to_value: data[k] == null ? null : String(data[k]),
                });
            }
        }),
    };
    return { eventsLog };
});

import { tasksService } from './tasks.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem, insertProjectRepo } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('tasksService', () => {
    describe('list / get / count', () => {
        it('returns empty list with no tasks', async () => {
            expect(await tasksService.list()).toEqual([]);
            expect(await tasksService.count()).toBe(0);
            expect(await tasksService.awaitingPickupCount()).toBe(0);
        });

        it('list() returns rows with sub_task_count enrichment', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E1' });
            await insertItem({
                id: 's1',
                type: 'sub_task',
                project_id: 'p1',
                parent_id: task.id,
                parent_type: 'task',
                title: 'S1',
            });
            await insertItem({
                id: 's2',
                type: 'sub_task',
                project_id: 'p1',
                parent_id: task.id,
                parent_type: 'task',
                title: 'S2',
            });
            const list = await tasksService.list();
            expect(list).toHaveLength(1);
            expect(list[0]!.sub_task_count).toBe(2);
        });

        it('list(projectId) scopes to a single project', async () => {
            await insertProject('p2', 'BBB');
            await tasksService.create({ project_id: 'p1', title: 'a' });
            await tasksService.create({ project_id: 'p2', title: 'b' });
            const p1 = await tasksService.list('p1');
            expect(p1).toHaveLength(1);
            expect(p1[0]!.project_id).toBe('p1');
        });

        it('get(id) returns the row or undefined', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            expect(await tasksService.get(task.id)).toBeDefined();
            expect(await tasksService.get('nope')).toBeUndefined();
        });

        it('awaitingPickupCount counts only ready status', async () => {
            await tasksService.create({ project_id: 'p1', title: 'draft' });
            const e2 = await tasksService.create({ project_id: 'p1', title: 'ready' });
            await tasksService.transition(e2.id, 'ready');
            expect(await tasksService.awaitingPickupCount()).toBe(1);
        });

        it('list(_, includeArchived=true) returns done tasks regardless of age', async () => {
            // Seed a done task whose updated_at is old enough to be filtered
            // out by the default archive window (`> 7 days`). Then verify
            // includeArchived=true bypasses that filter and returns the row.
            // Disable the items_set_updated_at BEFORE-UPDATE trigger for
            // this test's session so our manual updated_at reset sticks;
            // the trigger would otherwise clobber it with NOW().
            await sql`ALTER TABLE items DISABLE TRIGGER items_set_updated_at`.execute(testDb);
            try {
                const fresh = await tasksService.create({ project_id: 'p1', title: 'fresh' });
                const stale = await tasksService.create({
                    project_id: 'p1',
                    title: 'stale-done',
                });
                await tasksService.transition(stale.id, 'done', true);
                await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = ${stale.id}`.execute(testDb);

                const withoutArchive = await tasksService.list();
                expect(withoutArchive.map((e) => e.id)).toEqual([fresh.id]);

                const withArchive = await tasksService.list(undefined, true);
                expect(withArchive.map((e) => e.id).sort()).toEqual(
                    [fresh.id, stale.id].sort(),
                );
            } finally {
                await sql`ALTER TABLE items ENABLE TRIGGER items_set_updated_at`.execute(testDb);
            }
        });

        it('list scoped to projectId + includeArchived=true also bypasses the archive filter', async () => {
            // Exercises the combined `projectId` where-clause + the
            // include-archived early return path together.
            await sql`ALTER TABLE items DISABLE TRIGGER items_set_updated_at`.execute(testDb);
            try {
                const done = await tasksService.create({ project_id: 'p1', title: 'archived' });
                await tasksService.transition(done.id, 'done', true);
                await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = ${done.id}`.execute(testDb);

                const scoped = await tasksService.list('p1', true);
                expect(scoped.map((e) => e.id)).toContain(done.id);
                // And it is filtered out without archive:
                const notScoped = await tasksService.list('p1');
                expect(notScoped.map((e) => e.id)).not.toContain(done.id);
            } finally {
                await sql`ALTER TABLE items ENABLE TRIGGER items_set_updated_at`.execute(testDb);
            }
        });
    });

    describe('create', () => {
        it('allocates a key and records the created event', async () => {
            const task = await tasksService.create({
                project_id: 'p1',
                title: 'My Task',
                acceptance_criteria: 'it works',
                description: 'desc',
                priority: 'high',
                reporter_agent_id: 'agent-coder',
            });
            expect(task.id).toBe('ATL-1');
            expect(task.title).toBe('My Task');
            expect(task.acceptance_criteria).toBe('it works');
            expect(task.worktree_branch).toBeNull();
            expect(task.description).toBe('desc');
            expect(task.priority).toBe('high');
            expect(task.reporter_agent_id).toBe('agent-coder');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    item_type: 'task',
                    event_type: 'created',
                    to_value: 'My Task',
                }),
            );
        });

        it('applies defaults for omitted optional fields', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'minimal' });
            expect(task.description).toBe('');
            expect(task.priority).toBe('normal');
            expect(task.acceptance_criteria).toBe('');
            expect(task.spec_md).toBeNull();
            expect(task.reporter_agent_id).toBeNull();
            expect(task.assignee_agent_id).toBeNull();
        });

    });

    describe('update', () => {
        it('updates the named fields and logs title/description', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'Old' });
            vi.clearAllMocks();
            const updated = await tasksService.update(task.id, {
                title: 'New',
                description: 'fresh',
            });
            expect(updated.title).toBe('New');
            expect(updated.description).toBe('fresh');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'task', field: 'title' }),
            );
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'task', field: 'description' }),
            );
        });

        it('returns early when no defined keys are passed', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'Same' });
            vi.clearAllMocks();
            const after = await tasksService.update(task.id, {
                title: undefined,
                description: undefined,
            });
            expect(after.id).toBe(task.id);
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('logs priority changes (expanded LoggableField set, Theme 05)', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'p' });
            vi.clearAllMocks();
            await tasksService.update(task.id, { priority: 'urgent' });
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    item_type: 'task',
                    event_type: 'field_updated',
                    field: 'priority',
                    to_value: 'urgent',
                }),
            );
        });

        it('updates and logs the task spec fields (acceptance_criteria / spec_md / pr_url)', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 't' });
            vi.clearAllMocks();
            const after = await tasksService.update(task.id, {
                acceptance_criteria: 'AC',
                spec_md: '# Spec',
                pr_url: 'https://github.com/o/r/pull/1',
                worktree_branch: 'atlas/wf/ATL-1',
            });
            expect(after).toMatchObject({
                acceptance_criteria: 'AC',
                spec_md: '# Spec',
                pr_url: 'https://github.com/o/r/pull/1',
                worktree_branch: 'atlas/wf/ATL-1',
            });
            const fields = vi.mocked(eventsLog.record).mock.calls.map(([e]) => e.field);
            expect(fields).toEqual(['acceptance_criteria', 'spec_md', 'pr_url']);
        });

        it('throws when the task does not exist', async () => {
            await expect(tasksService.update('nope', { title: 'x' })).rejects.toThrow(/Task not found/);
        });
    });

    describe('transition', () => {
        it('advances draft → ready (valid)', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            const result = await tasksService.transition(task.id, 'ready');
            expect(result.status).toBe('ready');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_type: 'status_changed',
                    from_value: 'draft',
                    to_value: 'ready',
                }),
            );
        });

        it('rejects an invalid transition without override', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            await expect(tasksService.transition(task.id, 'done')).rejects.toThrow(/Invalid transition/);
        });

        it('accepts an invalid transition when override=true and records detail=override', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            const after = await tasksService.transition(task.id, 'done', true);
            expect(after.status).toBe('done');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'override' }),
            );
        });

        it('throws when the task does not exist', async () => {
            await expect(tasksService.transition('nope', 'ready')).rejects.toThrow(/Task not found/);
        });
    });

    describe('assign', () => {
        it('assigns an agent and logs the change', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            const after = await tasksService.assign(task.id, 'agent-coder');
            expect(after.assignee_agent_id).toBe('agent-coder');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ event_type: 'assigned' }),
            );
        });

        it('accepts null to unassign', async () => {
            const task = await tasksService.create({
                project_id: 'p1',
                title: 'E',
                assignee_agent_id: 'agent-coder',
            });
            const after = await tasksService.assign(task.id, null);
            expect(after.assignee_agent_id).toBeNull();
        });

        it('throws when the task does not exist', async () => {
            await expect(tasksService.assign('nope', null)).rejects.toThrow(/Task not found/);
        });
    });

    describe('delete', () => {
        it('removes the row and cascades to its sub-tasks', async () => {
            const task = await tasksService.create({ project_id: 'p1', title: 'E' });
            await insertItem({
                id: 's1',
                type: 'sub_task',
                project_id: 'p1',
                parent_id: task.id,
                parent_type: 'task',
                title: 'S',
            });
            await tasksService.delete(task.id);
            expect(await tasksService.get(task.id)).toBeUndefined();
            const remaining = await testDb
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('parent_id', '=', task.id)
                .executeTakeFirstOrThrow();
            expect(Number(remaining.n)).toBe(0);
        });
    });
});

// ADR 0018 — a Task always names at least one repo.
describe('tasksService repos (ADR 0018)', () => {
    it('fills repo_ids when the project has exactly one repo', async () => {
        const task = await tasksService.create({ project_id: 'p1', title: 'T' });
        expect(task.repo_ids).toEqual(['p1']);
    });

    it('400s when a multi-repo project gets a Task with no repos', async () => {
        await insertProjectRepo('p1', { name: 'web' });
        await expect(tasksService.create({ project_id: 'p1', title: 'T' })).rejects.toMatchObject({
            status: 400,
        });
    });

    it('400s when the project has no repos at all', async () => {
        await insertProject('p-bare', 'BAR', { no_repo: true });
        await expect(tasksService.create({ project_id: 'p-bare', title: 'T' })).rejects.toMatchObject({
            status: 400,
        });
    });

    it('400s when an update empties repo_ids on a multi-repo project', async () => {
        const web = await insertProjectRepo('p1', { name: 'web' });
        const task = await tasksService.create({ project_id: 'p1', title: 'T', repo_ids: [web] });
        await expect(tasksService.update(task.id, { repo_ids: [] })).rejects.toMatchObject({
            status: 400,
        });
    });

    it('re-fills an emptied repo_ids when the project has only one repo', async () => {
        const task = await tasksService.create({ project_id: 'p1', title: 'T' });
        const updated = await tasksService.update(task.id, { repo_ids: [] });
        expect(updated.repo_ids).toEqual(['p1']);
    });
});
