import type { Knex } from 'knex';

// Exact park kinds. Analytics used to bucket `workflow_run_events.reason` with
// a regex over the engine's prose; the engine now writes `park_kind` at every
// park site (`workflow-engine.ts` `park` / `parkFailed` / `waitOnChild`).
//
// Only the events table gets the column: `workflow_runs.park_reason` is the
// current wait and is nulled on resume, so nothing groups on it.
//
// Backfill is a one-off over the old prose. A free-text reason (an agent's
// own question, a gate's output) falls back to what the step at that node
// said: the last agent run's outcome, else a red gate there. Rows still
// unclassified get 'other'. The list is frozen here on purpose: a migration
// must not change when `WORKFLOW_PARK_KINDS` (@atlas/shared) grows.

const KINDS = [
    'question',
    'no_outcome',
    'review_requested',
    'rejected',
    'checklist_failed',
    'gate_failed',
    'check_unavailable',
    'loop_limit',
    'step_error',
    'setup_failed',
    'delivery_failed',
    'lost_step',
    'missing_agent',
    'dispatch_failed',
    'wiring_gap',
    'subtask_waiting',
    'other',
];

/** The backfill UPDATE, exported so a test can run it over hand-written rows. */
export const BACKFILL_PARK_KIND_SQL = `
    UPDATE public.workflow_run_events ev
       SET park_kind = CASE
           WHEN x.r ~ '^Sub-task \\S+ is waiting for you: ' THEN 'subtask_waiting'
           WHEN x.r ~* '^checklist_failed' THEN 'checklist_failed'
           WHEN x.r ~* '^(Loop limit reached|Sent back for late sub-tasks)' THEN 'loop_limit'
           WHEN x.r ~* 'has no command' THEN 'wiring_gap'
           WHEN x.r ~* '(could not run|had no repo to run in)' THEN 'check_unavailable'
           WHEN x.r ~* '^(Sent back to you|The workflow reached an Owner step)' THEN 'review_requested'
           WHEN x.r ~* '^(No pass connection|Workflow graph has no node|No Sub-tasks step runs)' THEN 'wiring_gap'
           WHEN x.r ~* 'Resume the run to retry delivery\\.$' THEN 'delivery_failed'
           WHEN x.r ~* '^(Could not prepare the worktree|Could not refresh the worktree|Project setup script failed)' THEN 'setup_failed'
           WHEN x.r ~* '^Could not start ' THEN 'dispatch_failed'
           WHEN x.r ~* '^Agent .* is missing or inactive$' THEN 'missing_agent'
           WHEN x.r ~* '^The agent step errored' THEN 'step_error'
           WHEN x.r ~* '^A step stopped reporting back' THEN 'lost_step'
           WHEN x.r ~* '^agent_did_not_signal_outcome' THEN 'no_outcome'
           WHEN x.r ~* '^(agent_asked_question|The agent needs input)' THEN 'question'
           WHEN x.r ~* '^(rejected|The agent rejected the work)' THEN 'rejected'
           ELSE COALESCE(
               (SELECT CASE a.outcome_kind WHEN 'asked_question' THEN 'question' WHEN 'rejected' THEN 'rejected' END
                  FROM public.agent_runs a
                 WHERE a.workflow_run_id = ev.workflow_run_id AND a.node_id = ev.node_id
                   AND a.created_at <= ev.created_at
                 ORDER BY a.created_at DESC LIMIT 1),
               (SELECT 'gate_failed'
                  FROM public.run_gate_results g
                 WHERE g.workflow_run_id = ev.workflow_run_id AND g.node_id = ev.node_id
                   AND g.created_at <= ev.created_at AND g.verdict IN ('fail', 'needs_review')
                 LIMIT 1),
               'other')
       END
      FROM (SELECT id, COALESCE(reason, '') AS r FROM public.workflow_run_events WHERE kind = 'parked') x
     WHERE x.id = ev.id AND ev.park_kind IS NULL
`;

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.workflow_run_events ADD COLUMN IF NOT EXISTS park_kind text');
    await knex.raw(BACKFILL_PARK_KIND_SQL);
    // A park always has a kind and a resume never does.
    await knex.raw(`
        ALTER TABLE public.workflow_run_events
            ADD CONSTRAINT workflow_run_events_park_kind_check CHECK (
                (kind = 'parked') = (park_kind IS NOT NULL)
                AND (park_kind IS NULL OR park_kind IN (${KINDS.map((k) => `'${k}'`).join(', ')}))
            )
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.workflow_run_events DROP CONSTRAINT IF EXISTS workflow_run_events_park_kind_check');
    await knex.raw('ALTER TABLE public.workflow_run_events DROP COLUMN IF EXISTS park_kind');
}
