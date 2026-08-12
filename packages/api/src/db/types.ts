import type { ColumnType, Generated } from 'kysely';
import type { AgentCli } from '@atlas/shared';

// Helper aliases
type TS = ColumnType<string, string | undefined, string>;
type TSn = ColumnType<string | null, string | null | undefined, string | null | undefined>;
type Int = ColumnType<number, number | undefined, number>;
type IntN = ColumnType<number | null, number | null | undefined, number | null | undefined>;
type Str = ColumnType<string, string | undefined, string>;
type StrN = ColumnType<string | null, string | null | undefined, string | null | undefined>;
type Bool0or1 = ColumnType<number, number | undefined, number>;
type CreatedAt = Generated<string>;
type UpdatedAt = ColumnType<string, string | undefined, string | undefined>;

export type ItemType = 'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug';
export type ItemRelation = 'relates_to' | 'depends_on' | 'tested_by';

export interface SettingsTable {
    id: number;
    owner_name: Str;
    workspace_path: Str;
    constitution_md: Str;
    external_notification_provider: ColumnType<
        'telegram' | 'teams',
        'telegram' | 'teams' | undefined,
        'telegram' | 'teams'
    >;
    external_notification_token: StrN;
    onboarding_complete: Int;
    external_notification_chat_id: StrN;
    external_notification_webhook_url: StrN;
    accent_color: Str;
    external_notification_event_toggles: Str;
    quiet_hours_from: StrN;
    quiet_hours_to: StrN;
    quiet_hours_timezone: StrN;
    quiet_hours_enabled: Int;
    external_notification_last_test_ok: IntN;
    external_notification_endpoint_label: StrN;
    vapid_public_key: StrN;
    vapid_private_key: StrN;
    guardrails_published_at: TSn;
    terminal_idle_notify_seconds: ColumnType<number, number | undefined, number>;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface AgentsTable {
    id: string;
    name: Str;
    category: 'software-dev' | 'marketing' | 'content' | 'design';
    cli: AgentCli;
    model: Str;
    // Task 6 — reasoning-effort knob forwarded to the CLI as `--effort`.
    // ColumnType lets callers omit it on insert (DB default 'medium').
    effort: ColumnType<
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    >;
    framework: Str;
    prompt_md: Str;
    prompt_version: Int;
    handoff_prompt_md: Str;
    status: 'active' | 'inactive';
    accent_color: Str;
    sort_order: Int;
    description: Str;
    designation: Str;
    // A08 — FK into the SDLC role catalog. Nullable: autonomous agents
    // (kind_slug != 'custom') stay NULL.
    role_id: StrN;
    max_rounds: Int;
    requires_item: ColumnType<boolean, boolean | undefined, boolean>;
    schedule_hours: ColumnType<number, number | undefined, number>;
    schedule_preset: ColumnType<
        'every_n_hours' | 'daily' | 'weekly' | 'monthly',
        'every_n_hours' | 'daily' | 'weekly' | 'monthly' | undefined,
        'every_n_hours' | 'daily' | 'weekly' | 'monthly'
    >;
    schedule_time_of_day: StrN;
    schedule_weekdays: ColumnType<
        number[] | null,
        number[] | null | undefined,
        number[] | null | undefined
    >;
    schedule_day_of_month: IntN;
    concurrent_runs: Int;
    glyph: Str;
    last_run_at: TSn;
    next_run_at: TSn;
    memory_cadence: Int;
    // Theme 09 — autonomous-agent fleet. `kind_slug` is a soft tag
    // (no CHECK constraint) so custom agents can carry their own.
    kind_slug: Str;
    // JSONB — `pg` auto-parses to JS values on select and accepts JS
    // values on insert/update. Routes validate per-kind_slug via Zod
    // at the boundary; the table type is unstructured.
    settings_json: ColumnType<
        Record<string, unknown>,
        Record<string, unknown> | undefined,
        Record<string, unknown>
    >;
    cron_expr: StrN;
    // Plan E — when true, the orchestrator opens a PR at run-end after
    // a successful push. Default false at the DB level (migration 055).
    raises_pr: ColumnType<boolean, boolean | undefined, boolean>;
    // Plan #7 — when true, the orchestrator pushes the worktree branch
    // to origin at run-end. When false, the branch lives locally only
    // and is deleted at cleanup. Default false (migration 066).
    push_code: ColumnType<boolean, boolean | undefined, boolean>;
    // When true, the orchestrator provisions a worktree before dispatch.
    // See IAgent.requires_worktree in shared/types for the full contract.
    requires_worktree: ColumnType<boolean, boolean | undefined, boolean>;
    // Marketplace back-link. NULL on user-only agents and on agents that
    // were detached. Editing the local agent never clears these; the user
    // explicitly Detaches to opt out of upgrade-available indicators.
    marketplace_source_id: StrN;
    marketplace_pulled_version: IntN;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

// Marketplace catalog tables. Seed reads the on-disk catalog
// (packages/api/src/marketplace/catalog/) and upserts these idempotently.
// content_hash is sha256 of the canonical JSON of the catalog entry so
// the seed can bump `version` only when content actually changes.
export interface MarketplaceAgentsTable {
    id: string;
    name: Str;
    category: 'software-dev' | 'marketing' | 'content' | 'design';
    cli: AgentCli;
    model: Str;
    effort: ColumnType<
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
        'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    >;
    framework: Str;
    prompt_md: Str;
    handoff_prompt_md: Str;
    description: Str;
    designation: Str;
    accent_color: Str;
    sort_order: Int;
    glyph: Str;
    role_id: StrN;
    max_rounds: Int;
    requires_item: ColumnType<boolean, boolean | undefined, boolean>;
    requires_worktree: ColumnType<boolean, boolean | undefined, boolean>;
    push_code: ColumnType<boolean, boolean | undefined, boolean>;
    raises_pr: ColumnType<boolean, boolean | undefined, boolean>;
    status: 'active' | 'inactive';
    kind_slug: Str;
    settings_json: ColumnType<
        Record<string, unknown>,
        Record<string, unknown> | undefined,
        Record<string, unknown>
    >;
    schedule_hours: ColumnType<number, number | undefined, number>;
    schedule_preset: ColumnType<
        'every_n_hours' | 'daily' | 'weekly' | 'monthly',
        'every_n_hours' | 'daily' | 'weekly' | 'monthly' | undefined,
        'every_n_hours' | 'daily' | 'weekly' | 'monthly'
    >;
    schedule_time_of_day: StrN;
    schedule_weekdays: ColumnType<
        number[] | null,
        number[] | null | undefined,
        number[] | null | undefined
    >;
    schedule_day_of_month: IntN;
    cron_expr: StrN;
    concurrent_runs: Int;
    memory_cadence: Int;
    memory_template_md: Str;
    summary: Str;
    version: Int;
    content_hash: Str;
    published_at: TS;
    updated_at: UpdatedAt;
}

export interface MarketplaceAgentHandoffsTable {
    id: Generated<number>;
    marketplace_agent_id: string;
    target_agent_id: Str;
    kind: 'on-pass' | 'on-fail';
    status: Str;
}

export interface MarketplaceAgentChecklistsTable {
    id: Generated<number>;
    marketplace_agent_id: string;
    label: string;
    sort_order: Int;
    required: ColumnType<boolean, boolean | undefined, boolean>;
}

// A08 — Canonical SDLC role catalog. One row per `SdlcRole`. Seeded in
// migration 025; editable at runtime via `PATCH /api/roles/:id` (Owner
// can re-curate default prompts without affecting existing agents).
// T1 — bundled reviewer column dropped; reviewer agents are standalone.
export interface RolesTable {
    id: string;
    label: Str;
    description: Str;
    default_prompt_md: Str;
    default_status: 'active' | 'inactive';
    sort_order: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface AgentHandoffRulesTable {
    id: Generated<number>;
    agent_id: string;
    target_agent_id: Str;
    kind: 'on-pass' | 'on-fail';
    status: Str;
}

export interface AgentChecklistsTable {
    id: Generated<number>;
    agent_id: string;
    label: string;
    sort_order: Int;
    required: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface AgentMemoryTable {
    agent_id: string;
    body_md: Str;
    version: Int;
    source: 'ai-generated' | 'manual-edit';
    last_run_id: StrN;
    runs_since_regen: Int;
    updated_at: UpdatedAt;
}

export type MemoryRegenerationTrigger = 'manual' | 'cadence' | 'high_signal' | 'mcp_update';

export interface MemoryRegenerationsTable {
    id: Generated<number>;
    agent_id: string;
    run_id: StrN;
    trigger: MemoryRegenerationTrigger;
    prev_version: Int;
    new_version: Int;
    prev_body_hash: string;
    new_body_hash: string;
    chars_added: Int;
    chars_removed: Int;
    // A06 — soft boundary-rule filter. Detected violations are persisted
    // as a list of slugs (`item_id`, `agent_id`, `project_id`, `run_id`).
    // Empty array on clean writes; the Memory tab badges non-empty rows.
    boundary_flags: ColumnType<string[], string[] | undefined, string[]>;
    created_at: CreatedAt;
}

export interface AgentPromptVersionsTable {
    id: Generated<number>;
    agent_id: string;
    version: number;
    body_md: string;
    edited_by: Str;
    reverted_from: IntN;
    created_at: CreatedAt;
}

export interface CredentialsTable {
    id: string;
    label: string;
    host: 'github';
    kind: ColumnType<'pat' | 'github_app', 'pat' | 'github_app' | undefined, 'pat' | 'github_app'>;
    username: Str;
    // Nullable since migration 023: `github_app` rows start without a minted
    // installation token; the credentials service fills them lazily.
    token_encrypted: StrN;
    token_fingerprint: StrN;
    scope: Str;
    last_used_at: TSn;
    expires_at: TSn;
    // github_app-only fields (migration 023). Nullable for PAT rows.
    app_id: IntN;
    app_private_key_encrypted: StrN;
    app_installation_owner: StrN;
    app_installation_id: IntN;
    // Migration 024 — App slug used to compose the bot's git identity
    // (`<slug>[bot]` name + `<id>+<slug>[bot]@users.noreply.github.com`
    // email). Populated from `app-config.json` on create, and best-effort
    // backfilled from `GET /app` on next refresh.
    app_slug: StrN;
    // Migration 025 — human-attribution fields. Used only for github_app
    // credentials to (a) append `Co-Authored-By: <human_name> <human_email>`
    // to every commit via a `prepare-commit-msg` hook and (b) assign the
    // human as the PR assignee via `gh pr create --assignee <login>`.
    // All three are nullable — leaving them blank gives bot-only
    // attribution (behaviour before migration 025).
    human_name: StrN;
    human_email: StrN;
    human_gh_login: StrN;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ProjectsTable {
    id: string;
    name: string;
    issue_key_prefix: string;
    git_path: Str;
    git_url: Str;
    credential_id: StrN;
    default_branch: Str;
    clone_status: 'pending' | 'cloning' | 'ready' | 'error';
    description: Str;
    status: Str;
    guardrails_md: Str;
    // Per-project setup scripts the orchestrator runs at worktree
    // provisioning time. Added by migration 004. NOT NULL DEFAULT ''.
    setup_sh_body: Str;
    setup_ps1_body: Str;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ProjectIssueCountersTable {
    project_id: string;
    last_seq: Int;
}

export interface ProjectSchedulesTable {
    project_id: string;
    enabled: Bool0or1;
    preset: Str;
    cron_expression: string;
    time_of_day: Str;
    weekday: IntN;
    skip_if_dirty: Bool0or1;
    pause_while_agents_active: Bool0or1;
    conflict_policy: 'skip' | 'stash' | 'abort';
    last_run_at: TSn;
    last_run_status: 'success' | 'skipped' | 'failure' | 'conflict' | null;
    last_run_detail: StrN;
    next_run_at: TSn;
    auth_failure_count: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ProjectGuardrailsTable {
    id: string;
    project_id: string;
    title: string;
    body_md: string;
    icon: Str;
    enabled: Bool0or1;
    sort_order: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ProjectEnvVarsTable {
    id: string;
    project_id: string;
    key: string;
    value_encrypted: string;
    updated_at: UpdatedAt;
}

// 2026-06-10 — Global tier of the two-scope secrets model. One row per
// org-wide key. Project-scoped overrides live in `project_env_vars`;
// the setup runner merges both maps with project winning on collision.
export interface EnvironmentSecretsTable {
    id: string;
    key: string;
    value_encrypted: string;
    updated_at: UpdatedAt;
}

export interface CliModelsTable {
    id: string;
    cli: AgentCli;
    model_name: string;
    note: StrN;
    sort_order: Int;
    created_at: CreatedAt;
}

export interface ToolCatalogTable {
    tool_name: string;
    group_name: string;
    description: string;
    sort_order: Int;
}

export interface GuardrailRulesTable {
    id: string;
    category:
        | 'file_system'
        | 'secrets_credentials'
        | 'git_branches'
        | 'side_effects_network'
        | 'escalation_scope';
    rule_text: string;
    detail: StrN;
    severity: 'block' | 'ask_owner' | 'warn';
    sort_order: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

// Phase 1.5b — Scripts are first-class entities, not properties of a
// rule. Two tables, same shape: guardrail_scripts (org-wide) and
// project_guardrail_scripts (per-project).
export interface GuardrailScriptsTable {
    id: string;
    name: string;
    description: string;
    body_sh: string;
    body_ps1: string;
    sort_order: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ProjectGuardrailScriptsTable {
    id: string;
    project_id: string;
    name: string;
    description: string;
    body_sh: string;
    body_ps1: string;
    sort_order: Int;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

// Phase 2 — `/commands` framework. Five artifact templates
// (`spec`, `plan`, `tasks`, `story`, `qa-plan`) that the templates-
// assembler writes to `<worktree>/.atlas/templates/<filename>` per
// run. Same id-primary-key shape as `guardrail_scripts`. Owner-editable
// via direct DB writes for now; a Settings tab follows.
export interface AgentTemplatesTable {
    id: string;
    filename: string;
    body_md: string;
    description: string;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface ItemsTable {
    id: string;
    project_id: string;
    type: ItemType;
    parent_id: StrN;
    parent_type: ColumnType<ItemType | null, ItemType | null | undefined, ItemType | null | undefined>;

    title: string;
    description: StrN;
    status: Str;
    assignee_agent_id: StrN;
    reporter_agent_id: StrN;

    priority: ColumnType<'low' | 'normal' | 'high' | 'urgent' | null, 'low' | 'normal' | 'high' | 'urgent' | null | undefined, 'low' | 'normal' | 'high' | 'urgent' | null | undefined>;

    spec_md: StrN;
    pr_url: StrN;
    points: IntN;

    acceptance_criteria: StrN;

    steps_to_reproduce: StrN;
    expected: StrN;
    actual: StrN;
    frequency: ColumnType<'always' | 'sometimes' | 'rare' | null, 'always' | 'sometimes' | 'rare' | null | undefined, 'always' | 'sometimes' | 'rare' | null | undefined>;
    failure_scope: ColumnType<'data-loss' | 'functional' | 'cosmetic' | 'performance' | null, 'data-loss' | 'functional' | 'cosmetic' | 'performance' | null | undefined, 'data-loss' | 'functional' | 'cosmetic' | 'performance' | null | undefined>;
    detected_at: TSn;
    occurrence_count: IntN;
    occurrence_total: IntN;

    started_at: TSn;

    // T2 — per-item git worktree fields. PO Writer fills `worktree_branch`
    // (format `atlas/dev/<storyId>` or `atlas/qa/<storyId>`); the
    // non-AI `worktree-orchestrator` resolves the on-disk path and
    // writes it back to `worktree_path` so re-runs reuse the same
    // checkout. Both nullable to support legacy items + non-coding
    // item kinds (epics, bugs without dev work, etc.).
    worktree_branch: StrN;
    worktree_path: StrN;

    // Task 1 — labels JSONB. Select returns string[]; insert/update
    // accept string[] | undefined (DB defaults to []).
    labels: ColumnType<string[], string[] | undefined, string[] | undefined>;

    created_at: CreatedAt;
    updated_at: UpdatedAt;
    search_tsv: ColumnType<string, never, never>;
}

export interface ItemLinksTable {
    id: Generated<number>;
    from_id: string;
    to_id: string;
    relation_type: ItemRelation;
    created_at: CreatedAt;
}

export interface ItemExternalLinksTable {
    id: Generated<number>;
    item_id: string;
    link_kind: 'pull_request';
    url: string;
    title: StrN;
    external_ref: StrN;
    created_at: CreatedAt;
    created_by_run_id: StrN;
}

export interface AgentRunsTable {
    id: string;
    agent_id: string;
    item_id: StrN;
    // Theme 09b — third run lifecycle: project-scope. item_id and
    // project_id are mutually exclusive in practice but the column
    // is independent so future kinds can mix if needed.
    project_id: StrN;
    status: 'queued' | 'in_progress' | 'completed' | 'error' | 'cancelled' | 'setup_failed';
    prompt_snapshot: StrN;
    output_text: StrN;
    // Captured stdout+stderr from the per-project setup script when it
    // fails (non-zero exit, timeout, unknown ${variable.X}). NULL on
    // runs that never invoked the setup step or where it succeeded.
    setup_output_text: StrN;
    started_at: TSn;
    completed_at: TSn;
    // Self-referential FK (parent_run_id → agent_runs.id ON DELETE CASCADE)
    // lives in migration 016. Links retries to their triggering run.
    parent_run_id: StrN;
    // Task 12 — unified outcome columns. Every agent (regardless of
    // performer/reviewer role) emits a fenced `atlas-outcome` block at
    // the end of its CLI output; `completeRun()` parses it via
    // `parseRunOutcome()` and writes these four fields. NULL on all four
    // means the agent produced unparseable output — runner treats that
    // as `'asked_question'` and parks the item with the Owner.
    outcome_kind: ColumnType<
        'done' | 'rejected' | 'asked_question' | null,
        'done' | 'rejected' | 'asked_question' | null | undefined,
        'done' | 'rejected' | 'asked_question' | null | undefined
    >;
    outcome_summary: StrN;
    outcome_reason: StrN;
    outcome_checklist: ColumnType<
        Array<{ id: number; passed: boolean; evidence?: string }> | null,
        string | null | undefined,
        string | null | undefined
    >;
    input_tokens: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    output_tokens: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    cache_creation_tokens: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    cache_read_tokens: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    total_cost_usd: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    // Plan B (Owner request 2026-06-01) — Copilot CLI native unit. The
    // value here is `usage.premiumRequests` from Copilot's `result`
    // event (count of model API calls). USD is converted at parse time
    // into `total_cost_usd`; this column preserves the raw count so the
    // UI can render it as a subscript under the dollar amount. Null on
    // Claude runs.
    credits: ColumnType<number | null, number | null | undefined, number | null | undefined>;
    created_at: CreatedAt;
}

export interface CommentsTable {
    id: Generated<number>;
    author: 'owner' | 'agent';
    agent_id: StrN;
    item_id: string;
    body: string;
    edited_at: TSn;
    // P11 — soft-delete tombstone. NULL = visible; non-null = hidden from
    // listComments / activity feed / reply-context but kept on disk for
    // audit.
    deleted_at: TSn;
    created_at: CreatedAt;
}

export interface NotificationsTable {
    id: Generated<number>;
    event_type: string;
    message: string;
    item_id: StrN;
    sent_external: Bool0or1;
    kind: 'needs_you' | 'update' | 'system';
    agent_id: StrN;
    external_status: 'none' | 'pending' | 'sent' | 'failed';
    failure_reason: StrN;
    read_at: TSn;
    project_id: StrN;
    push_status: ColumnType<
        'none' | 'pending' | 'sent' | 'failed',
        'none' | 'pending' | 'sent' | 'failed' | undefined,
        'none' | 'pending' | 'sent' | 'failed'
    >;
    push_failure_reason: StrN;
    link_url: StrN;
    created_at: CreatedAt;
}

export interface PushSubscriptionsTable {
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: StrN;
    created_at: CreatedAt;
    last_seen_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface IssueEventsTable {
    id: Generated<number>;
    item_id: string;
    event_type:
        | 'created'
        | 'status_changed'
        | 'assigned'
        | 'field_updated'
        | 'unblocked'
        | 'comment_added'
        | 'link_created'
        | 'link_deleted'
        | 'rounds_reset'
        | 'deleted'
        | 'dispatch_blocked'
        | 'history_pruned';
    actor_agent_id: StrN;
    field: StrN;
    from_value: StrN;
    to_value: StrN;
    detail: StrN;
    created_at: CreatedAt;
}

export interface AgentRoundCountsTable {
    id: Generated<number>;
    item_id: string;
    performer_agent_id: string;
    count: Int;
    last_incremented_at: TS;
}

export interface RemindersTable {
    id: Generated<number>;
    label: Str;
    body: Str;
    schedule_kind: ColumnType<
        'once' | 'daily' | 'weekly' | 'cron',
        'once' | 'daily' | 'weekly' | 'cron',
        'once' | 'daily' | 'weekly' | 'cron'
    >;
    schedule_value: Str;
    channel: ColumnType<
        'external' | 'notification' | 'both',
        'external' | 'notification' | 'both' | undefined,
        'external' | 'notification' | 'both'
    >;
    next_fire_at: TS;
    last_fired_at: TSn;
    created_by_agent_id: StrN;
    status: ColumnType<
        'active' | 'paused' | 'cancelled' | 'completed',
        'active' | 'paused' | 'cancelled' | 'completed' | undefined,
        'active' | 'paused' | 'cancelled' | 'completed'
    >;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

// P12 — Scratch Pad. Free-form markdown tiles for the Owner; no FK back to
// items / projects. id is TEXT (client-minted ULID) so optimistic creates
// don't collide on reload.
export interface ScratchPadTable {
    id: string;
    title: Str;
    body_md: Str;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
}

export interface DB {
    settings: SettingsTable;
    agents: AgentsTable;
    roles: RolesTable;
    agent_round_counts: AgentRoundCountsTable;
    reminders: RemindersTable;
    scratch_pad: ScratchPadTable;
    agent_handoff_rules: AgentHandoffRulesTable;
    agent_checklists: AgentChecklistsTable;
    agent_memory: AgentMemoryTable;
    agent_prompt_versions: AgentPromptVersionsTable;
    credentials: CredentialsTable;
    projects: ProjectsTable;
    project_issue_counters: ProjectIssueCountersTable;
    project_schedules: ProjectSchedulesTable;
    project_guardrails: ProjectGuardrailsTable;
    project_env_vars: ProjectEnvVarsTable;
    environment_secrets: EnvironmentSecretsTable;
    cli_models: CliModelsTable;
    tool_catalog: ToolCatalogTable;
    guardrail_rules: GuardrailRulesTable;
    items: ItemsTable;
    item_links: ItemLinksTable;
    item_external_links: ItemExternalLinksTable;
    agent_runs: AgentRunsTable;
    comments: CommentsTable;
    notifications: NotificationsTable;
    push_subscriptions: PushSubscriptionsTable;
    issue_events: IssueEventsTable;
    memory_regenerations: MemoryRegenerationsTable;
    commit_verifications: CommitVerificationsTable;
    marketplace_agents: MarketplaceAgentsTable;
    marketplace_agent_handoffs: MarketplaceAgentHandoffsTable;
    marketplace_agent_checklists: MarketplaceAgentChecklistsTable;
    guardrail_scripts: GuardrailScriptsTable;
    project_guardrail_scripts: ProjectGuardrailScriptsTable;
    agent_templates: AgentTemplatesTable;
    cli_sessions: CliSessionsTable;
    cli_session_subagents: CliSessionSubagentsTable;
}

// 2026-06-22 — Terminal v1. PTY-backed Claude Code sessions hosted in
// the web app. See migration 012_cli_sessions.ts and
// `services/cli-session-host.ts`.
export interface CliSessionsTable {
    id: string;
    // Nullable since migration 030: null marks a STANDALONE session — a PTY
    // opened directly on a folder the Owner picked, with no project, no
    // worktree, and no `.atlas/` staging. Every standalone branch in
    // `routes/cli-sessions.ts` keys off this being null.
    project_id: StrN;
    title: Str;
    status: ColumnType<
        'active' | 'paused' | 'closed' | 'errored',
        'active' | 'paused' | 'closed' | 'errored' | undefined,
        'active' | 'paused' | 'closed' | 'errored'
    >;
    cli: ColumnType<AgentCli, AgentCli | undefined, AgentCli>;
    worktree_path: StrN;
    worktree_branch: StrN;
    claude_session_id: StrN;
    model: Str;
    initial_prompt: StrN;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
    last_active_at: ColumnType<string, string | undefined, string | undefined>;
    closed_at: TSn;
    finalize_pr_url: StrN;
    item_id: StrN;
    // Migration 030. Set only on standalone sessions — the credential the
    // Owner picked when opening the folder. Project sessions leave it null
    // and resolve `projects.credential_id` at spawn/resume instead.
    credential_id: StrN;
    transcript_jsonl: StrN;
    transcript_ingested_at: TSn;
    // Token + cost columns (re-added in migration 019 after migration 014
    // dropped them). Now populated by `pty-transcript-usage.ts` at
    // session close time, by summing per-event `usage` blocks from the
    // ingested JSONL transcript and multiplying by the model pricing
    // table in `claude-model-pricing.ts`. Null for copilot rows (no
    // equivalent per-event token data in copilot's events.jsonl).
    total_cost_usd: IntN;
    input_tokens: IntN;
    output_tokens: IntN;
    cache_creation_tokens: IntN;
    cache_read_tokens: IntN;
}

// 2026-07-03 — Terminal v4. One row per subagent invocation that a
// hosted CLI session spawned. See migration
// 027_cli_session_subagents.ts and `services/pty-transcript-usage.ts`
// (Claude) + `services/copilot-events-usage.ts` (Copilot).
export interface CliSessionSubagentsTable {
    id: string;
    cli_session_id: string;
    source: ColumnType<'claude_jsonl' | 'copilot_list', 'claude_jsonl' | 'copilot_list', 'claude_jsonl' | 'copilot_list'>;
    subagent_key: Str;
    agent_type: StrN;
    description: StrN;
    spawn_depth: IntN;
    input_tokens: IntN;
    output_tokens: IntN;
    cache_creation_tokens: IntN;
    cache_read_tokens: IntN;
    cost_usd: IntN;
    is_estimate: ColumnType<boolean, boolean | undefined, boolean>;
    started_at: TSn;
    ended_at: TSn;
    created_at: CreatedAt;
}

// Theme 11 — SDLC commit discipline audit.
export type CommitVerificationResult = 'compliant' | 'partial' | 'silent' | 'clean';

export interface CommitVerificationsTable {
    id: Generated<number>;
    run_id: string;
    item_id: StrN;
    agent_id: string;
    result: CommitVerificationResult;
    commit_count: Int;
    /**
     * JSONB array of `{ commit_sha?: string; reason: string }` shapes.
     * Routes return the parsed value; the auto-decoded `pg` driver
     * gives us the array directly on select.
     */
    problems: ColumnType<
        Array<{ commit_sha?: string; reason: string }>,
        Array<{ commit_sha?: string; reason: string }> | undefined,
        Array<{ commit_sha?: string; reason: string }>
    >;
    checked_at: CreatedAt;
}
