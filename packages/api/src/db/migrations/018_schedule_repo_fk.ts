import type { Knex } from 'knex';

// An auto-fetch schedule belongs to one repo (ADR 0018), but the baseline
// tied `project_schedules` to its project only. Removing a repo left its
// schedule behind: `GET /api/schedules` kept listing it and its cron kept
// firing at a repo that no longer exists. Drop the rows already orphaned,
// then let the repo's delete take its schedule with it.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        DELETE FROM public.project_schedules s
         WHERE NOT EXISTS (SELECT 1 FROM public.project_repos r WHERE r.id = s.repo_id);
        ALTER TABLE public.project_schedules DROP CONSTRAINT IF EXISTS project_schedules_repo_id_fkey;
        ALTER TABLE public.project_schedules
            ADD CONSTRAINT project_schedules_repo_id_fkey
            FOREIGN KEY (repo_id) REFERENCES public.project_repos (id) ON DELETE CASCADE;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE public.project_schedules DROP CONSTRAINT IF EXISTS project_schedules_repo_id_fkey;
    `);
}
