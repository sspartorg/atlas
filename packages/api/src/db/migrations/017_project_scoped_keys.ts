import type { Knex } from 'knex';

// Project guard-rail script slugs are the Owner's own names ("lint",
// "no-network"), meant to be unique per project. The baseline keyed the
// table on `id` alone, so a second project could not reuse a slug and the
// 409 named the wrong project. Key on (project_id, id); the new key leads
// with project_id, so the single-column project_id index is redundant.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE public.project_guardrail_scripts DROP CONSTRAINT project_guardrail_scripts_pkey;
        ALTER TABLE public.project_guardrail_scripts ADD CONSTRAINT project_guardrail_scripts_pkey PRIMARY KEY (project_id, id);
        DROP INDEX IF EXISTS public.idx_project_guardrail_scripts_project_id;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_project_guardrail_scripts_project_id ON public.project_guardrail_scripts (project_id);
        ALTER TABLE public.project_guardrail_scripts DROP CONSTRAINT project_guardrail_scripts_pkey;
        ALTER TABLE public.project_guardrail_scripts ADD CONSTRAINT project_guardrail_scripts_pkey PRIMARY KEY (id);
    `);
}
