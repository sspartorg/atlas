import type { Knex } from 'knex';

// Workflows the Owner published to the Marketplace. `bundle` is the exact zip
// `GET /api/workflows/:id/export` produces, so publishing adds no second
// format and "Use in a project" is the ordinary bundle import.
//
// One entry per source workflow (UNIQUE): publishing it again replaces the
// entry. SET NULL keeps the entry when its source workflow is deleted.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.published_workflows (
            id text PRIMARY KEY,
            name text NOT NULL,
            description text,
            source_workflow_id text UNIQUE REFERENCES public.workflows(id) ON DELETE SET NULL,
            bundle bytea NOT NULL,
            published_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now()
        );
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw('DROP TABLE IF EXISTS public.published_workflows');
}
