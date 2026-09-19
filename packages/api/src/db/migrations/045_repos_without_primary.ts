import type { Knex } from 'knex';

// ADR 0018 — a Project is a container and every repo in it is equal. The
// project's own git columns become one `project_repos` row whose id IS the
// project id: worktree paths (`worktrees/<repo id>/`), git-lock keys,
// `items.repo_ids` and `jira_sources.repo_id` already hold that id, so reusing
// it migrates the data without moving a folder or rewriting a reference.
//
// Supersedes the primary-repo decision in ADR 0017.

// The folder name, slugified, falling back to the project name and then to
// `repo`; suffixed when an extra repo of the same project already took it.
const MIGRATE_ROWS = `
    INSERT INTO public.project_repos
        (id, project_id, name, git_url, git_path, credential_id,
         default_branch, clone_status, setup_sh_body, setup_ps1_body, position)
    SELECT
        p.id,
        p.id,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM public.project_repos r
                WHERE r.project_id = p.id AND r.name = base.name
            ) THEN left(base.name, 37) || '-2'
            ELSE base.name
        END,
        p.git_url,
        p.git_path,
        p.credential_id,
        p.default_branch,
        p.clone_status,
        p.setup_sh_body,
        p.setup_ps1_body,
        0
    FROM public.projects p
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            NULLIF(
                left(
                    regexp_replace(
                        trim(both '-' from lower(
                            regexp_replace(COALESCE(NULLIF(p.git_path, ''), p.name), '^.*[/\\\\]', '')
                        )),
                        '[^a-z0-9-]', '-', 'g'
                    ),
                    40
                ),
                ''
            ),
            'repo'
        ) AS name
    ) base
    WHERE p.git_path <> '' OR p.git_url <> '';
`;

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(MIGRATE_ROWS);

    await knex.schema.raw(`
        -- Every Task worked "the primary" implicitly; name it now.
        UPDATE public.items i
        SET repo_ids = jsonb_build_array(i.project_id)
        WHERE i.repo_ids = '[]'::jsonb
          AND EXISTS (SELECT 1 FROM public.project_repos r WHERE r.id = i.project_id);

        ALTER TABLE public.project_schedules ADD COLUMN repo_id text;
        UPDATE public.project_schedules SET repo_id = project_id;
        DELETE FROM public.project_schedules
        WHERE repo_id NOT IN (SELECT id FROM public.project_repos);
        ALTER TABLE public.project_schedules
            ALTER COLUMN repo_id SET NOT NULL,
            DROP CONSTRAINT project_schedules_pkey,
            ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (repo_id),
            ADD CONSTRAINT project_schedules_repo_id_fkey
                FOREIGN KEY (repo_id) REFERENCES public.project_repos(id) ON DELETE CASCADE;

        ALTER TABLE public.cli_sessions ADD COLUMN repo_id text
            REFERENCES public.project_repos(id) ON DELETE SET NULL;
        UPDATE public.cli_sessions s
        SET repo_id = s.project_id
        WHERE s.project_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.project_repos r WHERE r.id = s.project_id);
        DROP INDEX IF EXISTS cli_sessions_one_active_per_project_branch;
        CREATE UNIQUE INDEX cli_sessions_one_active_per_repo_branch
            ON public.cli_sessions (repo_id, worktree_branch)
            WHERE status IN ('active', 'paused') AND worktree_branch IS NOT NULL;

        ALTER TABLE public.projects
            DROP COLUMN git_path,
            DROP COLUMN git_url,
            DROP COLUMN credential_id,
            DROP COLUMN default_branch,
            DROP COLUMN clone_status,
            DROP COLUMN setup_sh_body,
            DROP COLUMN setup_ps1_body;
    `);
}

// Lossy by design, the same way 043's down() is: repos added as ADR 0017
// "extras" have no project columns to go back to, so they stay in
// `project_repos` and only the migrated rows are folded back.
export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.projects
            ADD COLUMN git_path text DEFAULT ''::text NOT NULL,
            ADD COLUMN git_url text DEFAULT ''::text NOT NULL,
            ADD COLUMN credential_id text REFERENCES public.credentials(id) ON DELETE SET NULL,
            ADD COLUMN default_branch text DEFAULT 'main'::text NOT NULL,
            ADD COLUMN clone_status text DEFAULT 'ready'::text NOT NULL,
            ADD COLUMN setup_sh_body text DEFAULT ''::text NOT NULL,
            ADD COLUMN setup_ps1_body text DEFAULT ''::text NOT NULL;

        UPDATE public.projects p SET
            git_path = r.git_path,
            git_url = r.git_url,
            credential_id = r.credential_id,
            default_branch = r.default_branch,
            clone_status = r.clone_status,
            setup_sh_body = r.setup_sh_body,
            setup_ps1_body = r.setup_ps1_body
        FROM public.project_repos r
        WHERE r.id = p.id;

        DELETE FROM public.project_repos r WHERE r.id = r.project_id;

        DROP INDEX IF EXISTS cli_sessions_one_active_per_repo_branch;
        ALTER TABLE public.cli_sessions DROP COLUMN IF EXISTS repo_id;
        CREATE UNIQUE INDEX IF NOT EXISTS cli_sessions_one_active_per_project_branch
            ON public.cli_sessions (project_id, worktree_branch)
            WHERE status IN ('active', 'paused') AND worktree_branch IS NOT NULL;

        ALTER TABLE public.project_schedules
            DROP CONSTRAINT IF EXISTS project_schedules_repo_id_fkey,
            DROP CONSTRAINT IF EXISTS project_schedules_pkey,
            ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (project_id),
            DROP COLUMN IF EXISTS repo_id;
    `);
}
