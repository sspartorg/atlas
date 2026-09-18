import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexT } from 'knex';
import { truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { down, up } from './migrations/037_tasks_and_subtasks.js';

const knex = Knex({ client: 'pg', connection: process.env['DATABASE_URL'] ?? '', pool: { min: 0, max: 1 } });

afterAll(async () => {
    await knex.destroy();
});

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

// DDL is transactional in Postgres: each case rolls 037 back inside a
// transaction, plants pre-037 rows, and aborts at the end, so the shared
// test DB stays on the latest schema.
async function inPre037Schema(fn: (trx: KnexT.Transaction) => Promise<void>): Promise<void> {
    const trx = await knex.transaction();
    try {
        await down(trx);
        await fn(trx);
    } finally {
        await trx.rollback();
    }
}

async function items(trx: KnexT.Transaction) {
    const r = await trx.raw<{ rows: Array<Record<string, string | null>> }>(
        'SELECT id, type::text AS type, parent_id, parent_type::text AS parent_type, description, workflow_id FROM items ORDER BY id',
    );
    return Object.fromEntries(r.rows.map((row) => [row['id'], row]));
}

describe('migration 037 — tasks and sub-tasks', () => {
    it('folds epics/stories/bugs into tasks and sub-tasks, and down() restores epics/stories', async () => {
        await inPre037Schema(async (trx) => {
            await trx.raw(`
                INSERT INTO workflows (id, project_id, name) VALUES ('wf-1', 'p1', 'Dev');
                INSERT INTO items (id, project_id, type, title, description) VALUES ('E1', 'p1', 'epic', 'Epic', 'epic body');
                INSERT INTO items (id, project_id, type, parent_id, title, description, workflow_id)
                    VALUES ('S1', 'p1', 'story', 'E1', 'Story', 'story body', 'wf-1');
                INSERT INTO items (id, project_id, type, parent_id, title, description, steps_to_reproduce, expected, actual, frequency)
                    VALUES ('B1', 'p1', 'bug', 'E1', 'Bug', 'it breaks', '1. click', 'works', '', 'always');
                INSERT INTO items (id, project_id, type, parent_id, title) VALUES ('ST1', 'p1', 'sub_task', 'S1', 'Sub-task');
                INSERT INTO items (id, project_id, type, parent_id, title, description, expected)
                    VALUES ('SB1', 'p1', 'sub_bug', 'S1', 'Sub-bug', '', 'no crash');
                INSERT INTO notifications (event_type, message, link_url) VALUES
                    ('a', 'epic', '/epics/E1'), ('b', 'story', '/issues/stories/S1'), ('c', 'sub-bug', '/issues/sub-bugs/SB1'),
                    ('d', 'terminal', '/terminal/x');
            `);

            await up(trx);

            const after = await items(trx);
            expect(after['E1']).toMatchObject({ type: 'task', parent_id: null, parent_type: null, description: 'epic body' });
            // A story under an epic becomes a sub-task under the task; its
            // own workflow queueing is dropped (the Task's workflow runs it).
            expect(after['S1']).toMatchObject({ type: 'sub_task', parent_id: 'E1', parent_type: 'task', workflow_id: null });
            // A sub-task under a story moves up to the story's task.
            expect(after['ST1']).toMatchObject({ type: 'sub_task', parent_id: 'E1', parent_type: 'task' });
            expect(after['SB1']).toMatchObject({ type: 'sub_task', parent_id: 'E1', description: '### Expected\nno crash' });
            // Bug fields fold into the description; empty ones are skipped.
            expect(after['B1']).toMatchObject({
                type: 'sub_task',
                parent_id: 'E1',
                description: 'it breaks\n\n### Steps to reproduce\n1. click\n\n### Expected\nworks',
            });

            const cols = await trx.raw<{ rows: Array<{ column_name: string }> }>(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'items'",
            );
            const names = cols.rows.map((c) => c.column_name);
            for (const gone of ['steps_to_reproduce', 'expected', 'actual', 'frequency', 'failure_scope', 'detected_at', 'occurrence_count', 'occurrence_total', 'created_by_workflow_run_id']) {
                expect(names).not.toContain(gone);
            }

            const links = await trx.raw<{ rows: Array<{ link_url: string }> }>('SELECT link_url FROM notifications ORDER BY event_type');
            expect(links.rows.map((r) => r.link_url)).toEqual(['/tasks/E1', '/sub-tasks/S1', '/sub-tasks/SB1', '/terminal/x']);

            // The new trigger: tasks are roots, sub-tasks hang off a task. A
            // nested transaction is a savepoint, so the failure doesn't
            // abort the outer one.
            await expect(
                trx.transaction((sp) => sp.raw("INSERT INTO items (id, project_id, type, parent_id, title) VALUES ('X1', 'p1', 'sub_task', 'S1', 'nested')")),
            ).rejects.toThrow(/must be parented to a task/);

            await down(trx);

            const back = await items(trx);
            expect(back['E1']).toMatchObject({ type: 'epic', parent_type: null });
            for (const id of ['S1', 'B1', 'ST1', 'SB1']) {
                expect(back[id]).toMatchObject({ type: 'story', parent_id: 'E1', parent_type: 'epic' });
            }
            const oldLinks = await trx.raw<{ rows: Array<{ link_url: string }> }>('SELECT link_url FROM notifications ORDER BY event_type');
            expect(oldLinks.rows.map((r) => r.link_url)).toEqual(['/epics/E1', '/issues/stories/S1', '/issues/stories/SB1', '/terminal/x']);
        });
    });

    it('rejects anything but task / sub_task after up()', async () => {
        await inPre037Schema(async (trx) => {
            await up(trx);
            await trx.raw("INSERT INTO items (id, project_id, type, title) VALUES ('T1', 'p1', 'task', 'Task')");
            // Parented to a task, so the trigger lets it through to the CHECK.
            await expect(
                trx.raw("INSERT INTO items (id, project_id, type, parent_id, title) VALUES ('X1', 'p1', 'story', 'T1', 'old')"),
            ).rejects.toThrow(/items_type_check/);
        });
    });
});
