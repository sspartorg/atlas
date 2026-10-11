import type { Knex } from 'knex';

// Where a Script step's full output was written under `.atlas/checks/` (ADR
// 0028), so the run page can point the Owner at it. Null for rows from before
// Script steps. Its own migration: 006 is already applied wherever it has run,
// and a column added there would never reach those databases.

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.run_gate_results ADD COLUMN IF NOT EXISTS log_path text');
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.run_gate_results DROP COLUMN IF EXISTS log_path');
}
