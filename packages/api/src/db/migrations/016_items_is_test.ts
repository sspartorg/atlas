import type { Knex } from 'knex';

// Test runs stop leaving real Tasks in the Task list.
//
// `agentTestsService.run()` materialises the item its agent acts on through the
// normal item services, on purpose: an agent that behaved differently against a
// synthetic item would make the test worthless (migration 014). The cost is
// that the item is real in every other way too — it takes an `ATL-nnn` key from
// the project counter and shows up in Tasks, search, the queue, counts, label
// filters and analytics. A `sub_task` template creates two of them, because the
// sub-task needs a throwaway parent.
//
// The only marker has been a `[test]` suffix in the title, which nothing reads.
//
// **Why a view rather than a predicate on thirty queries.** The edit count is
// the same either way. What differs is the next list query somebody writes: one
// that forgets `.where('is_test', '=', false)` looks exactly like one that
// remembers, whereas one that reads `items` where its siblings read
// `items_live` is visible in a diff. This turns "did you remember a predicate?"
// into "did you name the right relation?", which is a question review can
// actually answer.
//
// By-id reads keep using `items` — the run, the prompt builder, the workflow
// engine and the comment thread all need the item they are working on, and a
// test whose own item had vanished from under it would be a worse bug than the
// one this fixes.
//
// **`SELECT *` freezes the column list at creation.** A later migration that
// adds a column to `items` must recreate this view or `items_live` will silently
// lack it. `items-live-view.test.ts` compares the two column lists so that
// failure is a red test rather than a runtime error in production.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE items ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false`);

    // Everything an agent test ever materialised.
    await knex.raw(`
        UPDATE items SET is_test = true
         WHERE id IN (SELECT item_id FROM agent_test_runs WHERE item_id IS NOT NULL)
    `);
    // The throwaway parent a sub_task template creates, which `agent_test_runs`
    // never records — it only ever stores the sub-task it dispatched against.
    await knex.raw(`
        UPDATE items p SET is_test = true
         WHERE p.is_test = false
           AND EXISTS (SELECT 1 FROM items c WHERE c.parent_id = p.id AND c.is_test)
    `);
    // Rows whose `agent_test_runs` row was deleted before this shipped. The
    // suffix is `agentTestsService.run()`'s own format, not a guess: a title
    // ending in `[test] <name>`. Anchored so a Task that merely discusses
    // testing is left alone.
    await knex.raw(`
        UPDATE items SET is_test = true
         WHERE is_test = false AND title ~ '\\[test\\] [^\\]]+$'
    `);

    await knex.raw(`CREATE OR REPLACE VIEW items_live AS SELECT * FROM items WHERE NOT is_test`);

    // Every list and count reads the view, so the predicate has to be free.
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS items_not_test_idx
            ON items (project_id, type) WHERE NOT is_test
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP VIEW IF EXISTS items_live`);
    await knex.raw(`DROP INDEX IF EXISTS items_not_test_idx`);
    await knex.raw(`ALTER TABLE items DROP COLUMN IF EXISTS is_test`);
}
