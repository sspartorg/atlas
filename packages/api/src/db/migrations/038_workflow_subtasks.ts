import type { Knex } from 'knex';

// ADR 0015 — a Task's workflow run works its sub-tasks through a Sub-tasks
// step. Each sub-task gets a child run (`parent_workflow_run_id`) that shares
// the parent's worktree + branch; `input_kind = 'sub_task'` marks the
// sub-workflows those child runs execute.
//
// `max_parallel_runs` caps how many Task runs of one workflow run at once —
// sub-tasks inside a Task always run one at a time.
// `push_to_default` makes End push straight to the default branch (no PR),
// for publish-style workflows with no review.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.workflow_runs
            ADD COLUMN parent_workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
            ADD COLUMN parent_node_id text;
        CREATE INDEX workflow_runs_parent_idx ON public.workflow_runs (parent_workflow_run_id)
            WHERE parent_workflow_run_id IS NOT NULL;

        ALTER TABLE public.workflows
            DROP CONSTRAINT workflows_input_kind_check,
            ADD CONSTRAINT workflows_input_kind_check CHECK (input_kind IN ('item', 'none', 'sub_task')),
            ADD COLUMN max_parallel_runs integer NOT NULL DEFAULT 1
                CONSTRAINT workflows_max_parallel_runs_check CHECK (max_parallel_runs BETWEEN 1 AND 10),
            ADD COLUMN push_to_default boolean NOT NULL DEFAULT false;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DELETE FROM public.workflow_runs WHERE parent_workflow_run_id IS NOT NULL;
        DELETE FROM public.workflows WHERE input_kind = 'sub_task';

        ALTER TABLE public.workflows
            DROP COLUMN push_to_default,
            DROP COLUMN max_parallel_runs,
            DROP CONSTRAINT workflows_input_kind_check,
            ADD CONSTRAINT workflows_input_kind_check CHECK (input_kind IN ('item', 'none'));

        DROP INDEX IF EXISTS public.workflow_runs_parent_idx;
        ALTER TABLE public.workflow_runs
            DROP COLUMN parent_node_id,
            DROP COLUMN parent_workflow_run_id;
    `);
}
