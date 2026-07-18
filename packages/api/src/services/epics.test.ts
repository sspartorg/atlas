import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => {
    // Mirror the real `logFieldUpdates` closely enough that tests asserting
    // on `eventsLog.record` calls keep working after Theme 05's expansion.
    const FIELD_MAP: Record<string, string> = {
        title: 'title', description: 'description', spec_md: 'spec_md',
        pr_url: 'pr_url', points: 'points', acceptance_criteria: 'acceptance_criteria',
        priority: 'priority', steps_to_reproduce: 'steps_to_reproduce',
        expected: 'expected', actual: 'actual', frequency: 'frequency',
        failure_scope: 'failure_scope', reporter_agent_id: 'reporter',
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

import { epicsService } from './epics.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
});

afterAll(async () => {
    await closeTestDb();
});

describe('epicsService', () => {
    describe('list / get / count', () => {
        it('returns empty list with no epics', async () => {
            expect(await epicsService.list()).toEqual([]);
            expect(await epicsService.count()).toBe(0);
            expect(await epicsService.awaitingPickupCount()).toBe(0);
        });

        it('list() returns rows with story_count enrichment', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E1' });
            await insertItem({
                id: 's1',
                type: 'story',
                project_id: 'p1',
                parent_id: epic.id,
                parent_type: 'epic',
                title: 'S1',
            });
            await insertItem({
                id: 's2',
                type: 'story',
                project_id: 'p1',
                parent_id: epic.id,
                parent_type: 'epic',
                title: 'S2',
            });
            const list = await epicsService.list();
            expect(list).toHaveLength(1);
            expect(list[0]!.story_count).toBe(2);
        });

        it('list(projectId) scopes to a single project', async () => {
            await insertProject('p2', 'BBB');
            await epicsService.create({ project_id: 'p1', title: 'a' });
            await epicsService.create({ project_id: 'p2', title: 'b' });
            const p1 = await epicsService.list('p1');
            expect(p1).toHaveLength(1);
            expect(p1[0]!.project_id).toBe('p1');
        });

        it('get(id) returns the row or undefined', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            expect(await epicsService.get(epic.id)).toBeDefined();
            expect(await epicsService.get('nope')).toBeUndefined();
        });

        it('awaitingPickupCount counts only ready status', async () => {
            await epicsService.create({ project_id: 'p1', title: 'draft' });
            const e2 = await epicsService.create({ project_id: 'p1', title: 'ready' });
            await epicsService.transition(e2.id, 'ready');
            expect(await epicsService.awaitingPickupCount()).toBe(1);
        });

        it('list(_, includeArchived=true) returns done epics regardless of age', async () => {
            // Seed a done epic whose updated_at is old enough to be filtered
            // out by the default archive window (`> 7 days`). Then verify
            // includeArchived=true bypasses that filter and returns the row.
            // Disable the items_set_updated_at BEFORE-UPDATE trigger for
            // this test's session so our manual updated_at reset sticks;
            // the trigger would otherwise clobber it with NOW().
            await sql`ALTER TABLE items DISABLE TRIGGER items_set_updated_at`.execute(testDb);
            try {
                const fresh = await epicsService.create({ project_id: 'p1', title: 'fresh' });
                const stale = await epicsService.create({
                    project_id: 'p1',
                    title: 'stale-done',
                });
                await epicsService.transition(stale.id, 'done', true);
                await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = ${stale.id}`.execute(testDb);

                const withoutArchive = await epicsService.list();
                expect(withoutArchive.map((e) => e.id)).toEqual([fresh.id]);

                const withArchive = await epicsService.list(undefined, true);
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
                const done = await epicsService.create({ project_id: 'p1', title: 'archived' });
                await epicsService.transition(done.id, 'done', true);
                await sql`UPDATE items SET updated_at = NOW() - INTERVAL '30 days' WHERE id = ${done.id}`.execute(testDb);

                const scoped = await epicsService.list('p1', true);
                expect(scoped.map((e) => e.id)).toContain(done.id);
                // And it is filtered out without archive:
                const notScoped = await epicsService.list('p1');
                expect(notScoped.map((e) => e.id)).not.toContain(done.id);
            } finally {
                await sql`ALTER TABLE items ENABLE TRIGGER items_set_updated_at`.execute(testDb);
            }
        });
    });

    describe('create', () => {
        it('allocates a key and records the created event', async () => {
            const epic = await epicsService.create({
                project_id: 'p1',
                title: 'My Epic',
                description: 'desc',
                priority: 'high',
                reporter_agent_id: 'agent-coder',
            });
            expect(epic.id).toBe('ATL-1');
            expect(epic.title).toBe('My Epic');
            expect(epic.description).toBe('desc');
            expect(epic.priority).toBe('high');
            expect(epic.reporter_agent_id).toBe('agent-coder');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    item_type: 'epic',
                    event_type: 'created',
                    to_value: 'My Epic',
                }),
            );
        });

        it('applies defaults for omitted optional fields', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'minimal' });
            expect(epic.description).toBe('');
            expect(epic.priority).toBe('normal');
            expect(epic.reporter_agent_id).toBeNull();
            expect(epic.assignee_agent_id).toBeNull();
        });

        it('defaults to Owner (assignee=null, status=draft) even when reporter has on-pass rule', async () => {
            await insertAgent({ id: 'agent-reviewer', name: 'Reviewer' });
            await testDb
                .insertInto('agent_handoff_rules')
                .values({
                    agent_id: 'agent-coder',
                    target_agent_id: 'agent-reviewer',
                    kind: 'on-pass',
                    status: 'ready',
                })
                .execute();
            const epic = await epicsService.create({
                project_id: 'p1',
                title: 'Spawned epic',
                reporter_agent_id: 'agent-coder',
            });
            expect(epic.assignee_agent_id).toBeNull();
            expect(epic.status).toBe('draft');
        });

        it('respects explicit assignee override even when reporter has on-pass rule', async () => {
            await insertAgent({ id: 'agent-reviewer', name: 'Reviewer' });
            await testDb
                .insertInto('agent_handoff_rules')
                .values({
                    agent_id: 'agent-coder',
                    target_agent_id: 'agent-reviewer',
                    kind: 'on-pass',
                    status: 'ready',
                })
                .execute();
            const epic = await epicsService.create({
                project_id: 'p1',
                title: 'Spawned epic',
                reporter_agent_id: 'agent-coder',
                assignee_agent_id: 'agent-reviewer',
            });
            expect(epic.assignee_agent_id).toBe('agent-reviewer');
        });
    });

    describe('update', () => {
        it('updates the named fields and logs title/description', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'Old' });
            vi.clearAllMocks();
            const updated = await epicsService.update(epic.id, {
                title: 'New',
                description: 'fresh',
            });
            expect(updated.title).toBe('New');
            expect(updated.description).toBe('fresh');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'epic', field: 'title' }),
            );
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'epic', field: 'description' }),
            );
        });

        it('returns early when no defined keys are passed', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'Same' });
            vi.clearAllMocks();
            const after = await epicsService.update(epic.id, {
                title: undefined,
                description: undefined,
            });
            expect(after.id).toBe(epic.id);
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('logs priority changes (expanded LoggableField set, Theme 05)', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'p' });
            vi.clearAllMocks();
            await epicsService.update(epic.id, { priority: 'urgent' });
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    item_type: 'epic',
                    event_type: 'field_updated',
                    field: 'priority',
                    to_value: 'urgent',
                }),
            );
        });

        it('throws when the epic does not exist', async () => {
            await expect(epicsService.update('nope', { title: 'x' })).rejects.toThrow(/Epic not found/);
        });
    });

    describe('transition', () => {
        it('advances draft → ready (valid)', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            const result = await epicsService.transition(epic.id, 'ready');
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
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            await expect(epicsService.transition(epic.id, 'done')).rejects.toThrow(/Invalid transition/);
        });

        it('accepts an invalid transition when override=true and records detail=override', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            const after = await epicsService.transition(epic.id, 'done', true);
            expect(after.status).toBe('done');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'override' }),
            );
        });

        it('throws when the epic does not exist', async () => {
            await expect(epicsService.transition('nope', 'ready')).rejects.toThrow(/Epic not found/);
        });
    });

    describe('assign', () => {
        it('assigns an agent and logs the change', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            const after = await epicsService.assign(epic.id, 'agent-coder');
            expect(after.assignee_agent_id).toBe('agent-coder');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ event_type: 'assigned' }),
            );
        });

        it('accepts null to unassign', async () => {
            const epic = await epicsService.create({
                project_id: 'p1',
                title: 'E',
                assignee_agent_id: 'agent-coder',
            });
            const after = await epicsService.assign(epic.id, null);
            expect(after.assignee_agent_id).toBeNull();
        });

        it('throws when the epic does not exist', async () => {
            await expect(epicsService.assign('nope', null)).rejects.toThrow(/Epic not found/);
        });
    });

    describe('delete', () => {
        it('removes the row and cascades to story/bug children', async () => {
            const epic = await epicsService.create({ project_id: 'p1', title: 'E' });
            await insertItem({
                id: 's1',
                type: 'story',
                project_id: 'p1',
                parent_id: epic.id,
                parent_type: 'epic',
                title: 'S',
            });
            await insertItem({
                id: 'b1',
                type: 'bug',
                project_id: 'p1',
                parent_id: epic.id,
                parent_type: 'epic',
                title: 'B',
                acceptance_criteria: '',
                steps_to_reproduce: '',
                expected: '',
                actual: '',
                frequency: 'sometimes',
                failure_scope: 'cosmetic',
            });
            await epicsService.delete(epic.id);
            expect(await epicsService.get(epic.id)).toBeUndefined();
            const remaining = await testDb
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('parent_id', '=', epic.id)
                .executeTakeFirstOrThrow();
            expect(Number(remaining.n)).toBe(0);
        });
    });
});
