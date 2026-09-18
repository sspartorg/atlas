import type { Knex } from 'knex';

// ADR 0015 follow-ups.
// - `items.sort_order`: the Owner can put a Task's sub-tasks in the order its
//   Sub-tasks steps should run them. NULL = not ordered by hand; those run
//   after the ordered ones, oldest first.
// - `workflow_runs.gate_rounds`: how many times End sent a Task run back to a
//   Sub-tasks step for a late sub-task. It used to share `loop_count` with the
//   reviewers' fail loops, so a run with review churn ran out of room early.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.items ADD COLUMN sort_order integer;
        ALTER TABLE public.workflow_runs
            ADD COLUMN gate_rounds integer NOT NULL DEFAULT 0;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.workflow_runs DROP COLUMN gate_rounds;
        ALTER TABLE public.items DROP COLUMN sort_order;
    `);
}
