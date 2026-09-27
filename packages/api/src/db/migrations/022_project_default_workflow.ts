import type { Knex } from 'knex';

// A project's default workflow — what /tasks/new preselects in its Workflow
// select, so submitting a Task starts it without a second trip to the rail.
//
// Nullable, and it stays null until the Owner picks one: a default that
// appeared on its own would queue Tasks on a pipeline nobody chose.
//
// **Read only by the create form, never by the server on a transition.** Jira
// imports must not inherit it — a Jira source owns its workflow, and a
// workflow-less source leaves its Task a draft on purpose (ADR 0016). Applying
// this default server-side on every draft → ready would silently override that.
//
// ON DELETE SET NULL: deleting the workflow just clears the preselection; the
// project and its Tasks are unaffected.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_workflow_id text
            REFERENCES workflows(id) ON DELETE SET NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE projects DROP COLUMN IF EXISTS default_workflow_id`);
}
