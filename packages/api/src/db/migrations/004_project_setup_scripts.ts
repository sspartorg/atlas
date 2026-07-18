import type { Knex } from 'knex';

// 2026-06-10 — Per-project setup scripts.
//
// A project may need one-time configuration on a fresh worktree —
// symlinks, env-file generation, system tool checks, etc. Owner stores
// a `.sh` and a `.ps1` body per project in these two columns. The
// Setup tab on the Project Detail page lets the Owner edit them; later
// (separate task) the orchestrator will execute them at worktree
// provisioning time.
//
// One row per project, mirrors the `guardrails_md` column shape (also
// project-scoped single text). Empty string default keeps existing rows
// valid without a follow-up backfill.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.projects
            ADD COLUMN IF NOT EXISTS setup_sh_body text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS setup_ps1_body text NOT NULL DEFAULT '';
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.projects
            DROP COLUMN IF EXISTS setup_sh_body,
            DROP COLUMN IF EXISTS setup_ps1_body;
    `);
}
