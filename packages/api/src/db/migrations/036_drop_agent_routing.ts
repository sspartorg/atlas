import type { Knex } from 'knex';

// ADR 0014 hard cut — orchestration moved to workflows (035). Agents keep
// prompt, memory, checklists and CLI config; the per-agent schedule, routing
// (handoff rules, handoff prompt, round cap) and git-delivery flags go, on
// both installed agents and the marketplace catalog copy. No data is carried
// over: the Owner rebuilds chains as workflows.
//
// `down()` restores the columns with their baseline defaults and recreates
// the empty tables; the dropped values themselves are not recoverable.

const AGENT_COLUMNS = [
    'handoff_prompt_md',
    'max_rounds',
    'requires_item',
    'requires_worktree',
    'push_code',
    'raises_pr',
    'schedule_hours',
    'schedule_preset',
    'schedule_time_of_day',
    'schedule_weekdays',
    'schedule_day_of_month',
    'cron_expr',
    'concurrent_runs',
];

export async function up(knex: Knex): Promise<void> {
    const dropAgentCols = [...AGENT_COLUMNS, 'last_run_at', 'next_run_at']
        .map((c) => `DROP COLUMN IF EXISTS ${c}`)
        .join(',\n            ');
    const dropCatalogCols = AGENT_COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(',\n            ');
    await knex.schema.raw(`
        DROP TRIGGER IF EXISTS agents_cleanup_handoff_target ON public.agents;
        DROP FUNCTION IF EXISTS public.agents_cleanup_handoff_target();
        DROP TABLE IF EXISTS public.agent_handoff_rules;
        DROP TABLE IF EXISTS public.marketplace_agent_handoffs;
        DROP TABLE IF EXISTS public.agent_round_counts;
        ALTER TABLE public.agents
            ${dropAgentCols};
        ALTER TABLE public.marketplace_agents
            ${dropCatalogCols};
    `);
}

export async function down(knex: Knex): Promise<void> {
    const restore = (table: string) => `
        ALTER TABLE public.${table}
            ADD COLUMN IF NOT EXISTS handoff_prompt_md text DEFAULT ''::text NOT NULL,
            ADD COLUMN IF NOT EXISTS max_rounds integer DEFAULT 5 NOT NULL,
            ADD COLUMN IF NOT EXISTS requires_item boolean DEFAULT true NOT NULL,
            ADD COLUMN IF NOT EXISTS requires_worktree boolean DEFAULT false NOT NULL,
            ADD COLUMN IF NOT EXISTS push_code boolean DEFAULT false NOT NULL,
            ADD COLUMN IF NOT EXISTS raises_pr boolean DEFAULT false NOT NULL,
            ADD COLUMN IF NOT EXISTS schedule_hours double precision DEFAULT 6,
            ADD COLUMN IF NOT EXISTS schedule_preset text DEFAULT 'every_n_hours'::text,
            ADD COLUMN IF NOT EXISTS schedule_time_of_day text,
            ADD COLUMN IF NOT EXISTS schedule_weekdays integer[],
            ADD COLUMN IF NOT EXISTS schedule_day_of_month integer,
            ADD COLUMN IF NOT EXISTS cron_expr text,
            ADD COLUMN IF NOT EXISTS concurrent_runs integer DEFAULT 1 NOT NULL;`;
    await knex.schema.raw(`
        ${restore('agents')}
        ALTER TABLE public.agents
            ADD COLUMN IF NOT EXISTS last_run_at timestamp with time zone,
            ADD COLUMN IF NOT EXISTS next_run_at timestamp with time zone;
        ${restore('marketplace_agents')}
        CREATE TABLE IF NOT EXISTS public.agent_round_counts (
            id bigserial PRIMARY KEY,
            item_id text NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
            performer_agent_id text NOT NULL,
            count integer DEFAULT 0 NOT NULL,
            last_incremented_at timestamp with time zone DEFAULT now() NOT NULL
        );
        CREATE TABLE IF NOT EXISTS public.agent_handoff_rules (
            id bigserial PRIMARY KEY,
            agent_id text NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
            target_agent_id text DEFAULT ''::text NOT NULL,
            kind text NOT NULL CONSTRAINT agent_handoff_rules_kind_check CHECK (kind IN ('on-pass', 'on-fail')),
            status text DEFAULT 'ready'::text NOT NULL
        );
        CREATE TABLE IF NOT EXISTS public.marketplace_agent_handoffs (
            id bigserial PRIMARY KEY,
            marketplace_agent_id text NOT NULL REFERENCES public.marketplace_agents(id) ON DELETE CASCADE,
            target_agent_id text DEFAULT ''::text NOT NULL,
            kind text NOT NULL CONSTRAINT marketplace_agent_handoffs_kind_check CHECK (kind IN ('on-pass', 'on-fail')),
            status text DEFAULT 'ready'::text NOT NULL
        );
        CREATE OR REPLACE FUNCTION public.agents_cleanup_handoff_target() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                DELETE FROM agent_handoff_rules WHERE target_agent_id = OLD.id;
                RETURN OLD;
            END;
            $$;
        CREATE TRIGGER agents_cleanup_handoff_target AFTER DELETE ON public.agents
            FOR EACH ROW EXECUTE FUNCTION public.agents_cleanup_handoff_target();
    `);
}
