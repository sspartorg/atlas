import type { Knex } from 'knex';

// ADR 0017 — a Project holds several repos, and a Task can span several of
// them. The project's own git columns stay as its PRIMARY repo (id = the
// project id, so its worktree paths and git-lock key are unchanged);
// `project_repos` holds only the additional repos.
//
// `items.repo_ids` lists the repos a Task works on; `[]` means the primary
// only, so no backfill is needed. jsonb rather than a join table because the
// primary repo has no row to reference.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.project_repos (
            id text PRIMARY KEY,
            project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
            git_url text NOT NULL,
            git_path text NOT NULL,
            credential_id text REFERENCES public.credentials(id) ON DELETE SET NULL,
            default_branch text NOT NULL DEFAULT 'main',
            clone_status text NOT NULL DEFAULT 'ready'
                CHECK (clone_status IN ('pending', 'cloning', 'ready', 'error')),
            setup_sh_body text NOT NULL DEFAULT '',
            setup_ps1_body text NOT NULL DEFAULT '',
            position integer NOT NULL DEFAULT 0,
            created_at timestamp with time zone NOT NULL DEFAULT now(),
            CONSTRAINT project_repos_project_name_unique UNIQUE (project_id, name)
        );
        CREATE INDEX idx_project_repos_project_id ON public.project_repos (project_id);

        ALTER TABLE public.items ADD COLUMN repo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.items DROP COLUMN IF EXISTS repo_ids;
        DROP TABLE IF EXISTS public.project_repos;
    `);
}
