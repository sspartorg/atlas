import type { Knex } from 'knex';

// Page indexes: every query behind Dashboard, Settings, Scratchpad,
// Notifications, Reminders and Analytics, measured with EXPLAIN (ANALYZE,
// BUFFERS) on atlas_perf (8.4k items, 3k runs) plus a rolled-back seed of the
// tables it leaves empty (6k workflow runs, 4k terminal sessions, 59k status
// events, 20k notifications).
//
// - Window aggregates (Dashboard spend, Analytics spend) read the completed
//   agent_runs / closed cli_sessions partials index-only: the INCLUDE columns
//   are every column those SUM/GROUP BY queries touch.
// - Analytics delivery reads status events by time through a narrow partial;
//   workflows reads top-level runs, gate results and parks by time.
// - The notification staleness subquery ("a newer needs_you on this item")
//   probes (item_id, id) instead of every row on the item.
// - Every FK column gets a leading index, so a parent delete / SET NULL never
//   seq-scans the child (catalog check: hot-path-indexes.test.ts).
// - Dropped indexes are exact prefixes of another index on the same table
//   (a unique constraint or one added here), so no query loses a plan; each
//   only cost writes.
//
// Plain CREATE INDEX inside the migration transaction: these tables are small
// enough that the brief write lock is not worth CONCURRENTLY's no-transaction
// handling.

const COST_COLS = 'total_cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens';

const CREATE: Array<[name: string, def: string]> = [
    // Dashboard + Analytics spend: completed runs in a window.
    [
        'idx_agent_runs_completed_cover',
        `public.agent_runs (completed_at) INCLUDE (${COST_COLS}, agent_id, project_id, item_id, cli, model)
         WHERE status = 'completed' AND completed_at IS NOT NULL`,
    ],
    // Per-item cost rollups (analytics drill-downs, item-cost-tree).
    [
        'idx_agent_runs_item_completed_cover',
        `public.agent_runs (item_id) INCLUDE (${COST_COLS}, completed_at) WHERE status = 'completed'`,
    ],
    // Dashboard + Analytics terminal spend: closed sessions in a window.
    [
        'idx_cli_sessions_closed_cover',
        `public.cli_sessions (closed_at) INCLUDE (${COST_COLS}, cli, model, project_id)
         WHERE status = 'closed' AND closed_at IS NOT NULL`,
    ],
    // Dashboard queue (status = in_progress ORDER BY updated_at DESC LIMIT 20).
    ['idx_items_status_updated_at', 'public.items (status, updated_at DESC)'],
    // Dashboard done-this-week; Analytics WIP (type + status).
    ['idx_items_type_status_updated_at', 'public.items (type, status, updated_at)'],
    // Notification staleness subquery (services/notifications.ts notStaleNeedsYou).
    [
        'idx_notifications_needs_you_item',
        `public.notifications (item_id, id)
         WHERE kind = 'needs_you' AND event_type IN ('agent_completed', 'workflow_run')`,
    ],
    // Analytics delivery: status events by time.
    [
        'idx_issue_events_status_created_at',
        `public.issue_events (created_at) INCLUDE (item_id, from_value, to_value) WHERE field = 'status'`,
    ],
    // Task attachments list, per Jira issue in order.
    ['idx_jira_attachments_key_created', 'public.jira_attachments (jira_key, created_at, id)'],
    // Analytics workflows + delivery scorecard: top-level runs by start time.
    [
        'idx_workflow_runs_top_started_at',
        'public.workflow_runs (started_at) WHERE parent_workflow_run_id IS NULL',
    ],
    // Analytics workflows: gate verdicts and parks in a window.
    ['idx_run_gate_results_created_at', 'public.run_gate_results (created_at)'],
    [
        'idx_workflow_run_events_parked_created_at',
        `public.workflow_run_events (created_at) WHERE kind = 'parked'`,
    ],
    // FK coverage (catalog: every FK column lacking a leading, non-partial index).
    ['idx_workflow_runs_item_id', 'public.workflow_runs (item_id)'],
    ['idx_workflows_project_id', 'public.workflows (project_id)'],
    ['idx_agent_test_runs_item_id', 'public.agent_test_runs (item_id)'],
    ['idx_cli_sessions_credential_id', 'public.cli_sessions (credential_id)'],
    ['idx_cli_sessions_repo_id', 'public.cli_sessions (repo_id)'],
    ['idx_project_repos_credential_id', 'public.project_repos (credential_id)'],
    ['idx_team_config_credential_id', 'public.team_config (credential_id)'],
    ['idx_agent_tests_project_id', 'public.agent_tests (project_id)'],
    ['idx_agent_tests_repo_id', 'public.agent_tests (repo_id)'],
    ['idx_project_schedules_project_id', 'public.project_schedules (project_id)'],
    ['idx_agents_cli_model', 'public.agents (cli, model)'],
    ['idx_projects_default_workflow_id', 'public.projects (default_workflow_id)'],
    ['idx_jira_sources_workflow_id', 'public.jira_sources (workflow_id)'],
    ['idx_agent_memory_last_run_id', 'public.agent_memory (last_run_id)'],
];

// [dropped, the index that covers it] — recreated verbatim by `down`.
const DROP: Array<[name: string, def: string]> = [
    ['idx_items_status', 'public.items (status)'], // idx_items_status_updated_at
    ['idx_items_type_status', 'public.items (type, status)'], // idx_items_type_status_updated_at
    ['idx_items_project_type', 'public.items (project_id, type)'], // idx_items_project_type_status
    [
        'idx_agent_runs_status_completed_at',
        `public.agent_runs (status, completed_at DESC) WHERE status = 'completed' AND completed_at IS NOT NULL`,
    ], // idx_agent_runs_completed_cover
    ['idx_agent_prompt_versions_agent', 'public.agent_prompt_versions (agent_id, version DESC)'], // unique (agent_id, version)
    ['idx_cli_session_subagents_session', 'public.cli_session_subagents (cli_session_id)'], // unique (cli_session_id, subagent_key)
    ['idx_item_external_links_item_id', 'public.item_external_links (item_id)'], // unique (item_id, url)
    ['idx_project_env_vars_project', 'public.project_env_vars (project_id)'], // unique (project_id, key)
    ['idx_project_repos_project_id', 'public.project_repos (project_id)'], // unique (project_id, name)
];

export async function up(knex: Knex): Promise<void> {
    for (const [name, def] of CREATE) await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    for (const [name] of DROP) await knex.raw(`DROP INDEX IF EXISTS public.${name}`);
}

export async function down(knex: Knex): Promise<void> {
    for (const [name, def] of DROP) await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    for (const [name] of [...CREATE].reverse()) await knex.raw(`DROP INDEX IF EXISTS public.${name}`);
}
