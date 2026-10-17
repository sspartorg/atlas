import type { Knex } from 'knex';

// A project-scope run (no item, e.g. the AI scaffold) has no Task to name its
// repos, so it always worked the project's first repo — whatever repo the
// Owner picked. The run now records the repos it was started on.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `ALTER TABLE public.workflow_runs ADD COLUMN IF NOT EXISTS repo_ids jsonb DEFAULT '[]'::jsonb NOT NULL`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.workflow_runs DROP COLUMN IF EXISTS repo_ids');
}
