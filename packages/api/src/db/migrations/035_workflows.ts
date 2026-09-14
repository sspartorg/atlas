import type { Knex } from 'knex';

// Workflows (ADR 0014) — additive only. Nothing routes through these tables
// until the workflow engine lands; the agent-level schedule / handoff / git
// columns they replace are dropped in a later migration.
//
// `graph` is JSONB, not node + edge tables: the builder saves whole graphs
// and every run needs a frozen copy (`graph_snapshot`) regardless. Shape is
// enforced by `WorkflowGraphSchema` in @atlas/shared.
//
// CHECK, not enum types — same reasoning as link_kind in 020.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.workflows (
            id text PRIMARY KEY,
            project_id text REFERENCES public.projects(id) ON DELETE CASCADE,
            name text NOT NULL,
            description text,
            status text NOT NULL DEFAULT 'active'
                CONSTRAINT workflows_status_check CHECK (status IN ('active', 'inactive')),
            graph jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
            input_kind text NOT NULL DEFAULT 'item'
                CONSTRAINT workflows_input_kind_check CHECK (input_kind IN ('item', 'none')),
            trigger text NOT NULL DEFAULT 'manual'
                CONSTRAINT workflows_trigger_check CHECK (trigger IN ('manual', 'schedule', 'item_ready')),
            use_worktree boolean NOT NULL DEFAULT true,
            push_code boolean NOT NULL DEFAULT true,
            raises_pr boolean NOT NULL DEFAULT true,
            max_loops integer NOT NULL DEFAULT 3
                CONSTRAINT workflows_max_loops_check CHECK (max_loops BETWEEN 1 AND 20),
            schedule_preset text
                CONSTRAINT workflows_schedule_preset_check
                CHECK (schedule_preset IN ('hourly', 'every_4h', 'daily', 'weekly', 'custom')),
            schedule_time_of_day text,
            schedule_weekday integer,
            cron_expr text,
            next_run_at timestamp with time zone,
            last_run_at timestamp with time zone,
            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now(),
            -- An item queue or a worktree needs a repo; only a no-input,
            -- no-worktree workflow (a news digest, say) can be project-less.
            CONSTRAINT workflows_project_required_check
                CHECK (project_id IS NOT NULL OR (input_kind = 'none' AND NOT use_worktree))
        );
        CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON public.workflows
            FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();

        CREATE TABLE public.workflow_runs (
            id text PRIMARY KEY,
            workflow_id text NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
            item_id text REFERENCES public.items(id) ON DELETE SET NULL,
            -- No FK, like agent_runs.project_id: the workflow FK already
            -- cascades on project delete.
            project_id text,
            status text NOT NULL DEFAULT 'running'
                CONSTRAINT workflow_runs_status_check
                CHECK (status IN ('running', 'waiting_for_owner', 'completed', 'cancelled', 'error')),
            graph_snapshot jsonb NOT NULL,
            current_node_id text,
            parked_node_id text,
            loop_count integer NOT NULL DEFAULT 0,
            branch text,
            worktree_path text,
            setup_done boolean NOT NULL DEFAULT false,
            pr_url text,
            started_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now(),
            finished_at timestamp with time zone
        );
        CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON public.workflow_runs
            FOR EACH ROW EXECUTE FUNCTION public.atlas_set_updated_at();
        -- Between steps and during the End push / PR no agent_runs row is
        -- live, so agent_runs_one_live_per_item (003) cannot hold the item.
        -- A parked run still owns its worktree, so it counts as live too.
        CREATE UNIQUE INDEX workflow_runs_one_live_per_item ON public.workflow_runs (item_id)
            WHERE status IN ('running', 'waiting_for_owner');
        CREATE INDEX workflow_runs_workflow_started_idx ON public.workflow_runs (workflow_id, started_at DESC);

        -- SET NULL, not CASCADE: step rows (cost, outcome, model) are the
        -- evaluation history and must outlive a deleted workflow.
        ALTER TABLE public.agent_runs
            ADD COLUMN workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
            ADD COLUMN node_id text,
            ADD COLUMN cli text,
            ADD COLUMN model text,
            ADD COLUMN effort text,
            ADD COLUMN prompt_version integer;
        CREATE INDEX agent_runs_workflow_run_id_idx ON public.agent_runs (workflow_run_id)
            WHERE workflow_run_id IS NOT NULL;

        ALTER TABLE public.items
            ADD COLUMN workflow_id text REFERENCES public.workflows(id) ON DELETE SET NULL,
            ADD COLUMN created_by_workflow_run_id text REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
        CREATE INDEX items_workflow_status_idx ON public.items (workflow_id, status)
            WHERE workflow_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.items
            DROP COLUMN IF EXISTS created_by_workflow_run_id,
            DROP COLUMN IF EXISTS workflow_id;
        ALTER TABLE public.agent_runs
            DROP COLUMN IF EXISTS prompt_version,
            DROP COLUMN IF EXISTS effort,
            DROP COLUMN IF EXISTS model,
            DROP COLUMN IF EXISTS cli,
            DROP COLUMN IF EXISTS node_id,
            DROP COLUMN IF EXISTS workflow_run_id;
        DROP TABLE IF EXISTS public.workflow_runs;
        DROP TABLE IF EXISTS public.workflows;
    `);
}
