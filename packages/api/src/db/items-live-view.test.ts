import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { createItem } from '../services/items.js';
import { insertProject } from '../../tests/_items.js';

// `items_live` is `SELECT * FROM items WHERE NOT is_test` (migration 016), and
// Postgres resolves that `*` once, at creation. A later migration that adds a
// column to `items` will NOT add it to the view, but `db/types.ts` types the
// view with `ItemsTable` — so Kysely would happily generate SQL selecting a
// column the view does not have, and the first list query to touch it would
// fail at runtime, in production, on a page nobody changed.
//
// This is the whole cost of choosing a view over a predicate. Paying it here
// turns that into a red test on the migration that causes it.

describe('items_live', () => {
    afterAll(closeTestDb);

    it('exposes exactly the columns of items', async () => {
        const columns = async (table: string) =>
            (
                await sql<{ column_name: string }>`
                    SELECT column_name FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = ${table}
                     ORDER BY column_name
                `.execute(testDb)
            ).rows.map((r) => r.column_name);

        const [table, view] = await Promise.all([columns('items'), columns('items_live')]);
        expect(view).toEqual(table);
    });

    it('hides a test item and keeps every other one', async () => {
        await truncateAll();
        await insertProject('p1');
        const real = await createItem({ project_id: 'p1', type: 'task', title: 'real work' });
        const test = await createItem({ project_id: 'p1', type: 'task', title: 'probe [test] t', is_test: true });

        const live = await testDb.selectFrom('items_live').select('id').execute();
        expect(live.map((r) => r.id)).toEqual([real.id]);
        // Still there, and still reachable by id — the run depends on it.
        const all = await testDb.selectFrom('items').select('id').orderBy('id').execute();
        expect(all.map((r) => r.id).sort()).toEqual([real.id, test.id].sort());
    });

    it('defaults is_test to false so ordinary creates are unaffected', async () => {
        await truncateAll();
        await insertProject('p1');
        const row = await createItem({ project_id: 'p1', type: 'task', title: 'ordinary' });
        const stored = await testDb
            .selectFrom('items')
            .select('is_test')
            .where('id', '=', row.id)
            .executeTakeFirstOrThrow();
        expect(stored.is_test).toBe(false);
    });
});
