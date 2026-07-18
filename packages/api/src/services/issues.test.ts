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

import { subTasksService, subBugsService, bugsService } from './issues.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

async function seedEpicStory(): Promise<void> {
    await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E' });
    await insertItem({
        id: 'ATL-2',
        type: 'story',
        project_id: 'p1',
        parent_id: 'ATL-1',
        parent_type: 'epic',
        title: 'S',
    });
    await testDb
        .updateTable('project_issue_counters')
        .set({ last_seq: 2 })
        .where('project_id', '=', 'p1')
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await seedEpicStory();
});

afterAll(async () => {
    await closeTestDb();
});

// ──────────────────────────────────────────────────────────────────────────
describe('subTasksService', () => {
    describe('create / list / listAll / get', () => {
        it('creates a sub-task, allocates a key, logs created', async () => {
            const t = await subTasksService.create({
                story_id: 'ATL-2',
                title: 'Do thing',
                description: 'how',
                acceptance_criteria: 'AC',
                status: 'ready',
                reporter_agent_id: 'agent-coder',
            });
            expect(t.id).toMatch(/^ATL-\d+$/);
            expect(t.title).toBe('Do thing');
            expect(t.status).toBe('ready');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'sub_task', event_type: 'created' }),
            );
        });

        it('applies defaults', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 't' });
            expect(t.description).toBe('');
            expect(t.acceptance_criteria).toBe('');
            expect(t.status).toBe('draft');
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
            const t = await subTasksService.create({
                story_id: 'ATL-2',
                title: 'Spawned sub-task',
                reporter_agent_id: 'agent-coder',
            });
            expect(t.assignee_agent_id).toBeNull();
            expect(t.status).toBe('draft');
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
            const t = await subTasksService.create({
                story_id: 'ATL-2',
                title: 'Spawned sub-task',
                reporter_agent_id: 'agent-coder',
                assignee_agent_id: 'agent-reviewer',
            });
            expect(t.assignee_agent_id).toBe('agent-reviewer');
        });

        it('list scopes to one story; listAll returns all', async () => {
            await insertItem({
                id: 'ATL-99',
                type: 'story',
                project_id: 'p1',
                parent_id: 'ATL-1',
                parent_type: 'epic',
                title: 'S2',
            });
            await subTasksService.create({ story_id: 'ATL-2', title: 'A' });
            await subTasksService.create({ story_id: 'ATL-99', title: 'B' });
            expect(await subTasksService.list('ATL-2')).toHaveLength(1);
            expect(await subTasksService.listAll()).toHaveLength(2);
        });

        it('get returns row or undefined', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'g' });
            expect((await subTasksService.get(t.id))?.title).toBe('g');
            expect(await subTasksService.get('nope')).toBeUndefined();
        });
    });

    describe('update', () => {
        it('updates fields and logs title/description', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'Old' });
            vi.clearAllMocks();
            const after = await subTasksService.update(t.id, {
                title: 'New',
                description: 'd',
                acceptance_criteria: 'ac',
            });
            expect(after.title).toBe('New');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'title' }),
            );
        });

        it('update returns early when no defined keys', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            vi.clearAllMocks();
            await subTasksService.update(t.id, { title: undefined });
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('update throws when missing', async () => {
            await expect(subTasksService.update('nope', { title: 't' })).rejects.toThrow(/Sub-task not found/);
        });
    });

    describe('transition', () => {
        it('stamps started_at on first in_progress', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            await subTasksService.transition(t.id, 'ready');
            const after = await subTasksService.transition(t.id, 'in_progress');
            expect(after.status).toBe('in_progress');
            expect(after.started_at).toBeTruthy();
        });

        it('does not reset started_at on subsequent in_progress', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            await subTasksService.transition(t.id, 'ready');
            await subTasksService.transition(t.id, 'in_progress');
            const firstStart = (await subTasksService.get(t.id))!.started_at;
            await subTasksService.transition(t.id, 'draft', true);
            await subTasksService.transition(t.id, 'in_progress', true);
            const second = (await subTasksService.get(t.id))!.started_at;
            // PG returns timestamptz as Date instances; compare by ISO string.
            expect(String(second)).toBe(String(firstStart));
        });

        it('rejects invalid transitions without override', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            await expect(subTasksService.transition(t.id, 'done')).rejects.toThrow(/Invalid/);
        });

        it('accepts invalid transition with override and logs detail', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            const r = await subTasksService.transition(t.id, 'done', true);
            expect(r.status).toBe('done');
            // transition() now calls eventsLog.record(input, trx) inside a
            // transaction — the second argument is the trx executor. Match
            // with `expect.anything()` so the assertion doesn't need to know
            // whether a trx or the ambient db was passed.
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'override' }),
                expect.anything(),
            );
        });

        it('throws when missing', async () => {
            await expect(subTasksService.transition('nope', 'ready')).rejects.toThrow(/Sub-task not found/);
        });
    });

    describe('assign / delete', () => {
        it('assigns and clears agent', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            const r1 = await subTasksService.assign(t.id, 'agent-coder');
            expect(r1.assignee_agent_id).toBe('agent-coder');
            const r2 = await subTasksService.assign(t.id, null);
            expect(r2.assignee_agent_id).toBeNull();
        });

        it('assign throws when missing', async () => {
            await expect(subTasksService.assign('nope', null)).rejects.toThrow(/Sub-task not found/);
        });

        it('delete removes the row', async () => {
            const t = await subTasksService.create({ story_id: 'ATL-2', title: 'x' });
            await subTasksService.delete(t.id);
            expect(await subTasksService.get(t.id)).toBeUndefined();
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────
describe('subBugsService', () => {
    describe('create / list / listAll / get', () => {
        it('creates a sub-bug with bug-fields defaults + detected_at stamp', async () => {
            const b = await subBugsService.create({
                story_id: 'ATL-2',
                title: 'Repro',
                description: 'd',
                steps_to_reproduce: 'click',
                expected: 'works',
                actual: 'fails',
                frequency: 'always',
                failure_scope: 'functional',
                reporter_agent_id: 'agent-coder',
            });
            expect(b.id).toMatch(/^ATL-\d+$/);
            expect(b.frequency).toBe('always');
            expect(b.failure_scope).toBe('functional');
            expect(b.detected_at).toBeTruthy();
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'sub_bug', event_type: 'created' }),
            );
        });

        it('applies bug-field defaults', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'minimal' });
            expect(b.frequency).toBe('sometimes');
            expect(b.failure_scope).toBe('cosmetic');
            expect(b.status).toBe('draft');
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
            const b = await subBugsService.create({
                story_id: 'ATL-2',
                title: 'Spawned sub-bug',
                reporter_agent_id: 'agent-coder',
            });
            expect(b.assignee_agent_id).toBeNull();
            expect(b.status).toBe('draft');
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
            const b = await subBugsService.create({
                story_id: 'ATL-2',
                title: 'Spawned sub-bug',
                reporter_agent_id: 'agent-coder',
                assignee_agent_id: 'agent-reviewer',
            });
            expect(b.assignee_agent_id).toBe('agent-reviewer');
        });

        it('list/listAll/get', async () => {
            await insertItem({
                id: 'ATL-99',
                type: 'story',
                project_id: 'p1',
                parent_id: 'ATL-1',
                parent_type: 'epic',
                title: 'S2',
            });
            await subBugsService.create({ story_id: 'ATL-2', title: 'A' });
            await subBugsService.create({ story_id: 'ATL-99', title: 'B' });
            expect(await subBugsService.list('ATL-2')).toHaveLength(1);
            expect(await subBugsService.listAll()).toHaveLength(2);
            expect(await subBugsService.get('nope')).toBeUndefined();
        });
    });

    describe('update', () => {
        it('updates fields and logs', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'a' });
            vi.clearAllMocks();
            const after = await subBugsService.update(b.id, {
                title: 'b',
                description: 'd',
                expected: 'e',
                actual: 'a',
                frequency: 'rare',
                failure_scope: 'data-loss',
                steps_to_reproduce: 's',
                acceptance_criteria: 'ac',
            });
            expect(after.title).toBe('b');
            expect(after.frequency).toBe('rare');
            expect(after.failure_scope).toBe('data-loss');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'title' }),
            );
        });

        it('update no-op when nothing defined', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            vi.clearAllMocks();
            const after = await subBugsService.update(b.id, { title: undefined });
            expect(after.id).toBe(b.id);
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('update throws when missing', async () => {
            await expect(subBugsService.update('nope', { title: 'x' })).rejects.toThrow(/Sub-bug not found/);
        });

    });

    describe('transition / assign / delete', () => {
        it('happy path transition', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            const r = await subBugsService.transition(b.id, 'ready');
            expect(r.status).toBe('ready');
        });

        it('rejects invalid w/o override', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            await expect(subBugsService.transition(b.id, 'done')).rejects.toThrow(/Invalid/);
        });

        it('override path logs detail', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            await subBugsService.transition(b.id, 'done', true);
            // transition() now calls eventsLog.record(input, trx) inside a
            // transaction — see the sub-task test above.
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ detail: 'override' }),
                expect.anything(),
            );
        });

        it('transition throws when missing', async () => {
            await expect(subBugsService.transition('nope', 'ready')).rejects.toThrow(/Sub-bug not found/);
        });

        it('assign happy + missing', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            await subBugsService.assign(b.id, 'agent-coder');
            expect((await subBugsService.get(b.id))!.assignee_agent_id).toBe('agent-coder');
            await expect(subBugsService.assign('nope', null)).rejects.toThrow(/Sub-bug not found/);
        });

        it('delete removes row', async () => {
            const b = await subBugsService.create({ story_id: 'ATL-2', title: 'x' });
            await subBugsService.delete(b.id);
            expect(await subBugsService.get(b.id)).toBeUndefined();
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────
describe('bugsService', () => {
    describe('list with opts', () => {
        it('lists all when no opts', async () => {
            await bugsService.create({ epic_id: 'ATL-1', title: 'a' });
            await bugsService.create({ epic_id: 'ATL-1', title: 'b' });
            expect(await bugsService.list()).toHaveLength(2);
        });

        it('filters by epicId', async () => {
            await insertItem({ id: 'ATL-99', type: 'epic', project_id: 'p1', title: 'E2' });
            await bugsService.create({ epic_id: 'ATL-1', title: 'a' });
            await bugsService.create({ epic_id: 'ATL-99', title: 'b' });
            const list = await bugsService.list({ epicId: 'ATL-1' });
            expect(list).toHaveLength(1);
        });

        it('filters by projectId via JOIN', async () => {
            await insertProject('p2', 'BBB');
            await insertItem({ id: 'BBB-1', type: 'epic', project_id: 'p2', title: 'E' });
            await testDb
                .updateTable('project_issue_counters')
                .set({ last_seq: 1 })
                .where('project_id', '=', 'p2')
                .execute();
            await bugsService.create({ epic_id: 'ATL-1', title: 'a' });
            await bugsService.create({ epic_id: 'BBB-1', title: 'b' });
            const list = await bugsService.list({ projectId: 'p1' });
            expect(list).toHaveLength(1);
            expect(list[0]!.title).toBe('a');
        });

        it('get returns row or undefined', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'x' });
            expect((await bugsService.get(b.id))?.title).toBe('x');
            expect(await bugsService.get('nope')).toBeUndefined();
        });
    });

    describe('create / update', () => {
        it('create stamps detected_at and bug fields', async () => {
            const b = await bugsService.create({
                epic_id: 'ATL-1',
                title: 'B',
                description: 'd',
                frequency: 'rare',
                failure_scope: 'data-loss',
                steps_to_reproduce: 's',
                expected: 'e',
                actual: 'a',
            });
            expect(b.id).toMatch(/^ATL-\d+$/);
            expect(b.frequency).toBe('rare');
            expect(b.failure_scope).toBe('data-loss');
            expect(b.detected_at).toBeTruthy();
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'bug', event_type: 'created' }),
            );
        });

        it('create applies bug-field defaults', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'min' });
            expect(b.frequency).toBe('sometimes');
            expect(b.failure_scope).toBe('cosmetic');
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
            const b = await bugsService.create({
                epic_id: 'ATL-1',
                title: 'Spawned bug',
                reporter_agent_id: 'agent-coder',
            });
            expect(b.assignee_agent_id).toBeNull();
            expect(b.status).toBe('draft');
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
            const b = await bugsService.create({
                epic_id: 'ATL-1',
                title: 'Spawned bug',
                reporter_agent_id: 'agent-coder',
                assignee_agent_id: 'agent-reviewer',
            });
            expect(b.assignee_agent_id).toBe('agent-reviewer');
        });

        it('update logs title/description; no-op when undefined', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'x' });
            vi.clearAllMocks();
            await bugsService.update(b.id, { title: 'y', description: 'd' });
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'title' }),
            );
            vi.clearAllMocks();
            await bugsService.update(b.id, { title: undefined });
            expect(eventsLog.record).not.toHaveBeenCalled();
        });

        it('update throws when missing', async () => {
            await expect(bugsService.update('nope', { title: 'x' })).rejects.toThrow(/Bug not found/);
        });

    });

    describe('transition / assign / delete', () => {
        it('happy + invalid + override', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'x' });
            expect((await bugsService.transition(b.id, 'ready')).status).toBe('ready');
            await expect(bugsService.transition(b.id, 'done')).rejects.toThrow(/Invalid/);
            const overridden = await bugsService.transition(b.id, 'done', true);
            expect(overridden.status).toBe('done');
        });

        it('transition throws when missing', async () => {
            await expect(bugsService.transition('nope', 'ready')).rejects.toThrow(/Bug not found/);
        });

        it('assign happy + missing', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'x' });
            await bugsService.assign(b.id, 'agent-coder');
            expect((await bugsService.get(b.id))!.assignee_agent_id).toBe('agent-coder');
            await expect(bugsService.assign('nope', null)).rejects.toThrow(/Bug not found/);
        });

        it('delete removes row', async () => {
            const b = await bugsService.create({ epic_id: 'ATL-1', title: 'x' });
            await bugsService.delete(b.id);
            expect(await bugsService.get(b.id)).toBeUndefined();
        });
    });
});
