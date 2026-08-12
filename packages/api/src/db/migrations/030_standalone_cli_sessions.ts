import type { Knex } from 'knex';

// Standalone terminals — a PTY the Owner opens directly on a folder of their
// choosing, with no Atlas project, no worktree, and no `.atlas/` staging.
//
// Two schema moves:
//
//   1. `project_id` drops NOT NULL. `project_id IS NULL` is the discriminator
//      for the whole standalone mode; every route branch keys off it. The FK
//      itself stays (a nullable FK is still enforced when non-null), as does
//      ON DELETE CASCADE — standalone rows simply never match a project.
//
//   2. `credential_id` is new. Project sessions leave it null and resolve
//      `projects.credential_id` at spawn/resume; standalone sessions carry
//      the Owner's explicit pick. ON DELETE SET NULL rather than CASCADE:
//      deleting a credential must not delete the audit trail (and the cost
//      numbers) of every session that ever used it — the session just loses
//      its auth on the next resume, which surfaces as a normal push failure.
//
// The unique partial index `cli_sessions_one_active_per_project_branch`
// (migration 012) needs no change: it is already scoped
// `WHERE ... AND worktree_branch IS NOT NULL`, and standalone rows carry a
// null branch, so they can never collide with each other or with a worktree.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.cli_sessions
            ALTER COLUMN project_id DROP NOT NULL,
            ADD COLUMN IF NOT EXISTS credential_id text
                REFERENCES public.credentials(id) ON DELETE SET NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    // Standalone rows have no project to fall back to, so restoring NOT NULL
    // would fail on any live data. Delete them first — they are exactly the
    // rows this migration made representable, and the folders they point at
    // are the Owner's own directories, untouched by anything Atlas does.
    await knex.schema.raw(`
        DELETE FROM public.cli_sessions WHERE project_id IS NULL;

        ALTER TABLE public.cli_sessions
            DROP COLUMN IF EXISTS credential_id,
            ALTER COLUMN project_id SET NOT NULL;
    `);
}
