import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { down, up } from './migrations/041_published_workflows.js';

const knex = Knex({ client: 'pg', connection: process.env['DATABASE_URL'] ?? '', pool: { min: 0, max: 1 } });

afterAll(async () => {
    await knex.destroy();
    await closeTestDb();
});

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await testDb.insertInto('workflows').values({ id: 'wf-1', project_id: 'p1', name: 'Delivery' }).execute();
});

const entry = (id: string) => ({ id, name: 'Delivery', source_workflow_id: 'wf-1', bundle: Buffer.from('zip') });

describe('migration 041 — published workflows', () => {
    it('keeps one entry per source workflow, and the entry outlives the workflow', async () => {
        await testDb.insertInto('published_workflows').values(entry('pw-1')).execute();
        await expect(testDb.insertInto('published_workflows').values(entry('pw-2')).execute()).rejects.toMatchObject({ code: '23505' });

        await testDb.deleteFrom('workflows').where('id', '=', 'wf-1').execute();
        const row = await testDb.selectFrom('published_workflows').selectAll().executeTakeFirstOrThrow();
        expect(row).toMatchObject({ id: 'pw-1', source_workflow_id: null });
        expect(row.bundle.toString()).toBe('zip');
        expect(row.published_at).toEqual(row.updated_at);
    });

    it('down() drops the table and up() recreates it', async () => {
        const trx = await knex.transaction();
        try {
            await down(trx);
            expect(await trx.schema.hasTable('published_workflows')).toBe(false);
            await up(trx);
            expect(await trx.schema.hasTable('published_workflows')).toBe(true);
        } finally {
            await trx.rollback();
        }
    });
});
