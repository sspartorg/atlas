import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => {
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

import { sql } from 'kysely';
import { storiesService } from './stories.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

async function seedEpic(id = 'ATL-1', project_id = 'p1'): Promise<string> {
    await insertItem({ id, type: 'epic', project_id, title: 'Epic' });
    // Bump counter past the seeded epic so allocateIssueKey returns the next id.
    await testDb
        .updateTable('project_issue_counters')
        .set({ last_seq: 1 })
        .where('project_id', '=', project_id)
        .execute();
    return id;
}

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await seedEpic();
});

afterAll(async () => {
    await closeTestDb();
});

describe('storiesService', () => {
    describe('list', () => {
        it('returns empty list with no stories', async () => {
            expect(await storiesService.list()).toEqual([]);
            expect(await storiesService.list({ epicId: 'ATL-1' })).toEqual([]);
            expect(await storiesService.list({ projectId: 'p1' })).toEqual([]);
        });

        it('lists all stories when no filter', async () => {
            await storiesService.create({ epic_id: 'ATL-1', title: 'A' });
            await storiesService.create({ epic_id: 'ATL-1', title: 'B' });
            expect(await storiesService.list()).toHaveLength(2);
        });

        it('filters by epicId', async () => {
            await insertItem({ id: 'ATL-99', type: 'epic', project_id: 'p1', title: 'Other' });
            await storiesService.create({ epic_id: 'ATL-1', title: 'A' });
            await storiesService.create({ epic_id: 'ATL-99', title: 'X' });
            const list = await storiesService.list({ epicId: 'ATL-1' });
            expect(list).toHaveLength(1);
            expect(list[0]!.title).toBe('A');
        });

        it('filters by projectId via the join', async () => {
            await insertProject('p2', 'BBB');
            await insertItem({ id: 'BBB-1', type: 'epic', project_id: 'p2', title: 'Other' });
            await testDb
                .updateTable('project_issue_counters')
                .set({ last_seq: 1 })
                .where('project_id', '=', 'p2')
                .execute();
            await storiesService.create({ epic_id: 'ATL-1', title: 'A' });
            await storiesService.create({ epic_id: 'BBB-1', title: 'X' });
            const list = await storiesService.list({ projectId: 'p1' });
            expect(list).toHaveLength(1);
            expect(list[0]!.title).toBe('A');
        });
    });

    describe('get', () => {
        it('returns the row or undefined', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'S' });
            expect((await storiesService.get(s.id))?.title).toBe('S');
            expect(await storiesService.get('nope')).toBeUndefined();
        });
    });

    describe('create', () => {
        it('inserts a story, allocates a key, logs created', async () => {
            const s = await storiesService.create({
                epic_id: 'ATL-1',
                title: 'My Story',
                description: 'searchable body',
                acceptance_criteria: 'AC',
                status: 'ready',
                reporter_agent_id: 'agent-coder',
            });
            expect(s.id).toMatch(/^ATL-\d+$/);
            expect(s.title).toBe('My Story');
            expect(s.status).toBe('ready');
            expect(s.acceptance_criteria).toBe('AC');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'story', event_type: 'created' }),
            );
        });

        it('applies defaults for omitted fields', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 't' });
            expect(s.description).toBe('');
            expect(s.acceptance_criteria).toBe('');
            expect(s.status).toBe('draft');
            expect(s.assignee_agent_id).toBeNull();
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
            const s = await storiesService.create({
                epic_id: 'ATL-1',
                title: 'Child story',
                reporter_agent_id: 'agent-coder',
            });
            expect(s.assignee_agent_id).toBeNull();
            expect(s.status).toBe('draft');
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
            const s = await storiesService.create({
                epic_id: 'ATL-1',
                title: 'Child story',
                reporter_agent_id: 'agent-coder',
                assignee_agent_id: 'agent-reviewer',
            });
            expect(s.assignee_agent_id).toBe('agent-reviewer');
        });
    });

    describe('update', () => {
        it('patches fields and logs title/description', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'Old' });
            vi.clearAllMocks();
            const updated = await storiesService.update(s.id, {
                title: 'New',
                description: 'fresh',
                points: 5,
                pr_url: 'https://x',
                spec_md: '# spec',
                acceptance_criteria: 'AC',
            });
            expect(updated.title).toBe('New');
            expect(updated.description).toBe('fresh');
            expect(updated.points).toBe(5);
            expect(updated.pr_url).toBe('https://x');
            expect(updated.spec_md).toBe('# spec');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'title' }),
            );
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'description' }),
            );
        });

        it('returns early when no defined keys', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'x' });
            vi.clearAllMocks();
            const after = await storiesService.update(s.id, { title: undefined });
            expect(after.id).toBe(s.id);
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('throws when story does not exist', async () => {
            await expect(storiesService.update('nope', { title: 'x' })).rejects.toThrow(
                /Story not found/,
            );
        });
    });

    describe('transition', () => {
        it('advances draft → ready', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'x' });
            const r = await storiesService.transition(s.id, 'ready');
            expect(r.status).toBe('ready');
        });

        it('rejects an invalid transition without override', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'x' });
            await expect(storiesService.transition(s.id, 'done')).rejects.toThrow(/Invalid transition/);
        });

        it('accepts override=true with detail=override logged', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'x' });
            const r = await storiesService.transition(s.id, 'done', true);
            expect(r.status).toBe('done');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'override' }),
            );
        });

        it('throws when story does not exist', async () => {
            await expect(storiesService.transition('nope', 'ready')).rejects.toThrow(/Story not found/);
        });
    });

    describe('assign', () => {
        it('sets the agent assignee and logs', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'x' });
            const r = await storiesService.assign(s.id, 'agent-coder');
            expect(r.assignee_agent_id).toBe('agent-coder');
        });

        it('throws when story does not exist', async () => {
            await expect(storiesService.assign('nope', null)).rejects.toThrow(/Story not found/);
        });
    });

    describe('delete', () => {
        it('removes the row', async () => {
            const s = await storiesService.create({ epic_id: 'ATL-1', title: 'gone' });
            await storiesService.delete(s.id);
            expect(await storiesService.get(s.id)).toBeUndefined();
        });
    });

    describe('countInProgress / countDoneThisWeek', () => {
        it('counts stories in `in_progress` and `in_review` for countInProgress', async () => {
            const a = await storiesService.create({ epic_id: 'ATL-1', title: 'a' });
            const b = await storiesService.create({ epic_id: 'ATL-1', title: 'b' });
            await storiesService.create({ epic_id: 'ATL-1', title: 'c' });
            await testDb.updateTable('items').set({ status: 'in_progress' }).where('id', '=', a.id).execute();
            await testDb.updateTable('items').set({ status: 'in_review' }).where('id', '=', b.id).execute();
            expect(await storiesService.countInProgress()).toBe(2);
        });

        it('counts only done stories updated within the last 7 days', async () => {
            const a = await storiesService.create({ epic_id: 'ATL-1', title: 'a' });
            await testDb
                .updateTable('items')
                .set({ status: 'done' })
                .where('id', '=', a.id)
                .execute();
            // Bypass the items_set_updated_at trigger to plant an old
            // "done" story; the trigger would otherwise reset updated_at
            // to now() on every UPDATE.
            await sql`
                ALTER TABLE items DISABLE TRIGGER items_set_updated_at;
                INSERT INTO items (id, type, project_id, parent_id, parent_type, title, status, priority, updated_at, created_at)
                VALUES ('ATL-old', 'story', 'p1', 'ATL-1', 'epic', 'b', 'done', 'normal', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');
                ALTER TABLE items ENABLE TRIGGER items_set_updated_at;
            `.execute(testDb);
            expect(await storiesService.countDoneThisWeek()).toBe(1);
        });
    });
});
