import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => {
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

import { subTasksService } from './sub-tasks.js';
import { eventsLog } from './events-log.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

async function seedTask(): Promise<void> {
    await insertItem({ id: 'ATL-1', type: 'task', project_id: 'p1', title: 'T' });
    await testDb
        .updateTable('project_issue_counters')
        .set({ last_seq: 1 })
        .where('project_id', '=', 'p1')
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder' });
    await seedTask();
});

afterAll(async () => {
    await closeTestDb();
});

// ──────────────────────────────────────────────────────────────────────────
describe('subTasksService', () => {
    describe('create / list / listAll / get', () => {
        it('creates a sub-task, allocates a key, logs created', async () => {
            const t = await subTasksService.create({
                task_id: 'ATL-1',
                title: 'Do thing',
                description: 'how',
                acceptance_criteria: 'AC',
                status: 'ready',
                reporter_agent_id: 'agent-coder',
            });
            expect(t.id).toMatch(/^ATL-\d+$/);
            expect(t.task_id).toBe('ATL-1');
            expect(t.title).toBe('Do thing');
            expect(t.status).toBe('ready');
            expect(eventsLog.record).toHaveBeenCalledWith(
                expect.objectContaining({ item_type: 'sub_task', event_type: 'created' }),
            );
        });

        it('applies defaults', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 't' });
            expect(t.description).toBe('');
            expect(t.acceptance_criteria).toBe('');
            expect(t.status).toBe('draft');
        });

        it('list scopes to one task; listAll returns all', async () => {
            await insertItem({ id: 'ATL-99', type: 'task', project_id: 'p1', title: 'T2' });
            await subTasksService.create({ task_id: 'ATL-1', title: 'A' });
            await subTasksService.create({ task_id: 'ATL-99', title: 'B' });
            expect(await subTasksService.list('ATL-1')).toHaveLength(1);
            expect(await subTasksService.listAll()).toHaveLength(2);
        });

        it('refuses a sub-task whose parent is not a task', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'parent' });
            await expect(subTasksService.create({ task_id: t.id, title: 'nested' })).rejects.toThrow(
                /must be parented to a task/,
            );
        });

        it('get returns row or undefined', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'g' });
            expect((await subTasksService.get(t.id))?.title).toBe('g');
            expect(await subTasksService.get('nope')).toBeUndefined();
        });
    });

    describe('update', () => {
        it('updates fields and logs title/description', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'Old' });
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
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
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
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
            await subTasksService.transition(t.id, 'ready');
            const after = await subTasksService.transition(t.id, 'in_progress');
            expect(after.status).toBe('in_progress');
            expect(after.started_at).toBeTruthy();
        });

        it('does not reset started_at on subsequent in_progress', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
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
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
            await expect(subTasksService.transition(t.id, 'done')).rejects.toThrow(/Invalid/);
        });

        it('accepts invalid transition with override and logs detail', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
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
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
            const r1 = await subTasksService.assign(t.id, 'agent-coder');
            expect(r1.assignee_agent_id).toBe('agent-coder');
            const r2 = await subTasksService.assign(t.id, null);
            expect(r2.assignee_agent_id).toBeNull();
        });

        it('assign throws when missing', async () => {
            await expect(subTasksService.assign('nope', null)).rejects.toThrow(/Sub-task not found/);
        });

        it('delete removes the row', async () => {
            const t = await subTasksService.create({ task_id: 'ATL-1', title: 'x' });
            await subTasksService.delete(t.id);
            expect(await subTasksService.get(t.id)).toBeUndefined();
        });
    });
});
