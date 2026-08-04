export type AgentCli = 'claude' | 'copilot';
// Task 6 — reasoning-effort knob shared by both CLIs (verified live —
// `claude --effort` and `copilot --reasoning-effort` accept the same six
// values).
export type AgentEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentStatus = 'active' | 'inactive';
export type AgentCategory = 'software-dev' | 'marketing' | 'content' | 'design';

// A08 — Canonical SDLC role catalog. Every SDLC agent references one of
// these by `role_id`. Autonomous agents (Theme 09) keep `role_id = null`.
// `designation` (free-text per agent, A01) remains as an optional display
// override; when empty, the UI falls back to the role's label.
export type SdlcRole =
    | 'po'
    | 'spec-writer'
    | 'engineer'
    | 'qa'
    | 'architect'
    | 'tester'
    | 'automation'
    | 'devops'
    | 'security'
    | 'designer';

export const SDLC_ROLES: readonly SdlcRole[] = [
    'po',
    'spec-writer',
    'engineer',
    'qa',
    'architect',
    'tester',
    'automation',
    'devops',
    'security',
    'designer',
];

/**
 * A08 — Role catalog row. One per canonical SDLC role. Defaults govern
 * what a freshly-seeded agent of that role looks like:
 * - `default_status` decides whether the agent ships enabled. Only `po`,
 *   `engineer`, `qa`, `architect`, `automation` ship `active`; everything
 *   else ships `inactive` (the "disable-by-default" policy).
 * - `default_prompt_md` is the curated starter prompt. Agents copy this
 *   into their own `prompt_md` at seed time; the Owner can then edit
 *   per-agent without touching the role default. Owner can also edit the
 *   role default via `PATCH /api/roles/:id` to update the canonical
 *   starter without affecting existing agents.
 *
 * T1 — bundled-reviewer columns dropped. Each SDLC role's reviewer side
 * lives on its own dedicated agent row (`agent-<role>-reviewer`), so the
 * catalog only carries one prompt per role.
 */
export interface IRole {
    id: SdlcRole;
    label: string;
    description: string;
    default_prompt_md: string;
    default_status: AgentStatus;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/**
 * Outcome every agent run emits at the end of its CLI output via the
 * fenced `atlas-outcome` block. Replaces the prior performer/reviewer
 * split — there's one contract for every agent regardless of role.
 *
 *   - 'done'           → work succeeded; orchestrator applies the agent's
 *                        on-pass handoff (advancing the chain).
 *   - 'rejected'       → the agent rejected the work (typically a
 *                        reviewer-style agent); orchestrator applies the
 *                        agent's on-fail handoff (usually back to the
 *                        paired performer or the Owner).
 *   - 'asked_question' → agent is blocked on Owner input and posted a
 *                        clarifying-question comment; orchestrator parks
 *                        the item in `waiting_for_info` (no handoff).
 *
 * NULL when the agent's output didn't contain a parseable `atlas-outcome`
 * block — the runner treats that as `'asked_question'` (Owner-bound) so
 * a silent agent never advances the chain.
 */
export type RunOutcomeKind = 'done' | 'rejected' | 'asked_question';

export interface IRunOutcomeChecklistItem {
    id: number;
    passed: boolean;
    evidence?: string;
}

export interface IRunOutcome {
    kind: RunOutcomeKind;
    /** Free-text summary of what the agent did this round. Always populated when kind='done'. */
    summary?: string;
    /** Free-text rationale. Populated when kind='rejected' (why) or 'asked_question' (what's blocking). */
    reason?: string;
    /** Per-required-checklist-row pass/fail report. Populated when the agent has required rows. */
    checklist?: IRunOutcomeChecklistItem[];
}

export type CredentialHost = 'github';
export type CredentialKind = 'pat' | 'github_app';
export type CloneStatus = 'pending' | 'cloning' | 'ready' | 'error';

export type IssueStatus =
    | 'draft'
    | 'ready'
    | 'in_progress'
    | 'waiting_for_info'
    | 'in_review'
    | 'done';

// SubTaskStatus collapses into the unified IssueStatus. Kept as an alias so
// older imports don't break, but new code should use IssueStatus directly.
export type SubTaskStatus = IssueStatus;
// `setup_failed` (added 2026-06-10) is the terminal state when the
// user-authored per-project setup script exits non-zero, times out, or
// references an unknown secret. `runProjectSetup` writes the captured
// stdout/stderr to `agent_runs.setup_output_text` and skips CLI dispatch.
export type RunStatus =
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'error'
    | 'cancelled'
    | 'setup_failed';
export type IssueType = 'epic' | 'story' | 'sub_task' | 'sub_bug' | 'bug';
export type IssuePriority = 'low' | 'normal' | 'high' | 'urgent';

export type BugFrequency = 'always' | 'sometimes' | 'rare';
export type BugFailureScope = 'data-loss' | 'functional' | 'cosmetic' | 'performance';

export const BUG_FREQUENCIES: BugFrequency[] = ['always', 'sometimes', 'rare'];
export const BUG_FAILURE_SCOPES: BugFailureScope[] = [
    'data-loss',
    'functional',
    'cosmetic',
    'performance',
];

export interface IAgent {
    id: string;
    name: string;
    category: AgentCategory;
    cli: AgentCli;
    model: string;
    /**
     * Task 6 — reasoning-effort level forwarded to the CLI as
     * `--effort <value>`. DB default 'medium'; both claude and copilot
     * accept the same value set.
     */
    effort: AgentEffort;
    framework: string;
    prompt_md: string;
    prompt_version: number;
    /**
     * Markdown text the agent uses when handing the item off to the next agent
     * (or back to the Owner). Persisted on the agent row; previously this was
     * stashed in browser localStorage by the Handoffs tab — that hack is gone.
     */
    handoff_prompt_md: string;
    status: AgentStatus;
    accent_color: string;
    sort_order: number;
    description: string;
    /**
     * Human-readable role label shown in the UI alongside `name`. Examples:
     * 'Product Owner', 'Code Review Lead', 'QA'. Empty string is allowed —
     * A08 makes this an optional override on top of the role catalog: when
     * empty, UI falls back to the role's `label` (and ultimately to
     * `category` for autonomous agents with `role_id = null`).
     */
    designation: string;
    /**
     * A08 — Foreign key to the SDLC role catalog. NULL on autonomous
     * agents (Theme 09 — ai-news, market-research, regulations,
     * jira-to-epic, ai-readiness) which sit outside the SDLC chain.
     * For SDLC agents this drives default-status policy at seed time and
     * the Role filter chip on the Agents page.
     */
    role_id: SdlcRole | null;
    /**
     * Cap on CLI invocations against (item, agent). The round counter
     * (`agent_round_counts`) is keyed on `(item_id, agent_id)`; when the
     * count exceeds this value, the orchestrator escalates the item to the
     * Owner with `status: waiting_for_info` instead of re-spawning the
     * agent on the same item. T1: with reviewer agents standalone, the
     * cap applies to each agent independently — reviewer bounces are
     * inter-agent handoffs, not intra-agent retries.
     */
    max_rounds: number;
    /**
     * When false, the scheduler dispatches this agent on its cadence even
     * with an empty item queue ("freedom mode"). The resulting run has
     * `item_id = null`.
     */
    requires_item: boolean;
    schedule_hours: number;
    /**
     * Schedule shape. `every_n_hours` uses `schedule_hours`; the other
     * three use `schedule_time_of_day` plus their preset-specific field
     * (`schedule_weekdays` for weekly, `schedule_day_of_month` for monthly).
     * Default at the DB level is `'every_n_hours'` so pre-migration rows
     * keep firing on their existing cadence.
     */
    schedule_preset: AgentSchedulePreset;
    /** 'HH:MM' in 24-hour process-local time. Used by daily/weekly/monthly. */
    schedule_time_of_day: string | null;
    /**
     * ISO weekdays (Mon=1 .. Sun=7), 1-7 distinct entries. Used by weekly.
     * Stored as a PG int[] column; nullable for non-weekly presets.
     */
    schedule_weekdays: number[] | null;
    /**
     * 1..31. Used by monthly. Months without that day clamp to the last
     * day of the month at fire time (Jan 31 → Feb 28 / Feb 29 in leap).
     */
    schedule_day_of_month: number | null;
    concurrent_runs: number;
    glyph: string;
    /**
     * Last time the clock-driven poller dispatched at least one ready
     * item for this agent. Null until the first dispatch.
     */
    last_run_at: string | null;
    /**
     * Next scheduled fire, computed by `computeNextAgentSlot`. The poller
     * fires the agent when `next_run_at <= now` AND the queue has at
     * least one ready item. Null until the create/update path seeds it.
     */
    next_run_at: string | null;
    /**
     * Theme 08 — how many completed/errored runs trigger an automatic
     * `agent_memory` regeneration. Errored runs count double (errors
     * carry more signal). 1..100 (DB CHECK constraint), default 5.
     * Editable from the Agent Detail Overview tab.
     */
    memory_cadence: number;
    /**
     * Theme 09 — soft archetype tag. The seeded autonomous-agent
     * fleet uses fixed slugs ('ai-news' | 'market-research' |
     * 'regulations' | 'jira-to-epic'); custom agents the Owner adds
     * carry 'custom'. Drives per-kind settings_json validation in
     * the API layer and the per-kind form on the Autonomous tab.
     */
    kind_slug: AgentKindSlug;
    /**
     * Theme 09 — JSONB blob of per-archetype config. Shape depends
     * on `kind_slug`; the per-kind schemas live in
     * `@atlas/shared/agents/settings-schemas` and validate at the
     * route boundary.
     */
    settings_json: Record<string, unknown>;
    /**
     * Theme 09 — optional cron expression (croner-compatible). When
     * non-null, overrides `schedule_hours` in the scheduler. Seeded
     * ai-news agent uses '0 9 * * *' for 09:00 user-local.
     */
    cron_expr: string | null;
    /**
     * When true, the orchestrator opens a pull request on `origin` at run-end
     * after a successful push. The agent itself never touches `gh`/`git push`
     * — the API server's GitHub token + the worktree's `worktree_branch` are
     * authoritative. Seeded `true` for the three reviewer agents that close
     * out an SDLC chain (Coder Reviewer, QA Reviewer, Automation Reviewer);
     * `false` for every performer agent and every non-SDLC autonomous agent.
     * Flip on a new reviewer to grant it the PR machinery for free.
     */
    raises_pr: boolean;
    /**
     * Plan #7 — when true, the orchestrator pushes the worktree branch
     * to origin at run-end. When false, the branch lives locally only
     * and is deleted at cleanup. Independent of `raises_pr` (PR opening
     * uses gh and may push via its own auth path; performer-leg
     * pushes are controlled by this flag).
     */
    push_code: boolean;
    /**
     * When true, the orchestrator provisions an isolated git worktree before
     * dispatching the run — using `item.worktree_branch` when item-attached,
     * or a generated `atlas/<kind_slug|role_id|'run'>/<short-runId>` for
     * project-scope. When false, the agent runs directly in
     * `project.git_path` (or the workspace path when no project is set).
     */
    requires_worktree: boolean;
    /**
     * Marketplace back-link. Set when the agent was forked from a catalog
     * entry (either by the first-run auto-install or an explicit Add).
     * NULL on user-only agents and on agents the Owner has Detached. The
     * runtime never gates editing on this — it's only used to surface an
     * "upgrade available" indicator when the catalog version drifts ahead.
     */
    marketplace_source_id: string | null;
    /**
     * The marketplace_agents.version that was current when this local
     * agent last accepted/dismissed an upgrade. NULL paired with
     * marketplace_source_id == null. When marketplace_pulled_version is
     * strictly less than the live marketplace_agents.version, an upgrade
     * is available.
     */
    marketplace_pulled_version: number | null;
    created_at: string;
    updated_at: string;
}

export type AgentKindSlug =
    | 'ai-news'
    | 'market-research'
    | 'regulations'
    | 'jira-to-epic'
    | 'ai-readiness'
    | 'knowledge-base'
    | 'custom';

export const AGENT_KIND_SLUGS: readonly AgentKindSlug[] = [
    'ai-news',
    'market-research',
    'regulations',
    'jira-to-epic',
    'ai-readiness',
    'knowledge-base',
    'custom',
];

// Per-kind settings shapes. Each maps to a Zod schema in
// `@atlas/shared/agents/settings-schemas`. Adding a new kind here
// means: (1) add the slug above, (2) add the interface here, (3) add
// the schema in settings-schemas.ts, (4) add a form in
// AutonomousSettingsTab.tsx.

export interface IAINewsSettings {
    sources?: string[];
    topic?: string;
    external_notification_event_key?: string;
}

export interface IMarketResearchSettings {
    competitors: Array<{ name: string; homepage: string; pricing_page?: string }>;
    tracking_project_id?: string | null;
    cadence_hours?: number;
}

export type ProjectType =
    | 'saas'
    | 'fintech'
    | 'healthcare'
    | 'ecommerce'
    | 'gaming'
    | 'enterprise'
    | 'other';

export type RegulationsRegion = 'US' | 'EU' | 'UK' | 'IN' | 'CA' | 'AU';

export interface IRegulationsSettings {
    project_type: ProjectType;
    regions: RegulationsRegion[];
    tracking_project_id?: string | null;
}

export interface IJiraToEpicSettings {
    atlassian_resource_id: string;
    jql: string;
    target_project_id: string;
    dry_run?: boolean;
}

export type AgentSchedulePreset =
    | 'every_n_hours'
    | 'daily'
    | 'weekly'
    | 'monthly';

/**
 * Which leg of the handoff a rule applies to. Each agent has at most one
 * `on-pass` rule (target + status when all checks pass) and one `on-fail`
 * rule (target + status when any check fails).
 */
export type AgentHandoffKind = 'on-pass' | 'on-fail';

export interface IProject {
    id: string;
    name: string;
    // Jira-style 3-letter uppercase prefix used as the namespace for every
    // issue id in this project (e.g. CER → CER-1, CER-2, ...). Frozen once
    // set; retired into retired_prefixes when the project is deleted.
    issue_key_prefix: string;
    git_path: string;
    git_url: string;
    credential_id: string | null;
    default_branch: string;
    clone_status: CloneStatus;
    description: string;
    status: string;
    guardrails_md: string;
    // 2026-06-10 — Per-project setup scripts. Edited via the Setup tab on
    // Project Detail; execution wiring is a separate follow-up.
    setup_sh_body: string;
    setup_ps1_body: string;
    created_at: string;
    updated_at: string;
    // Most recent timestamp across the project row and any of its children
    // (schedule runs, guardrail edits, epic/story/sub-task/sub-bug/bug edits).
    // Computed at read time in projectsService.list/get — never persisted.
    last_activity_at: string;
}

export interface ICredential {
    id: string;
    label: string;
    host: CredentialHost;
    kind: CredentialKind;
    username: string;
    /** Null for `github_app` credentials before the first token has been minted. */
    token_encrypted: string | null;
    /** Null for `github_app` credentials before the first token has been minted. */
    token_fingerprint: string | null;
    scope: string;
    last_used_at: string | null;
    expires_at: string | null;
    /** Populated only when `kind = 'github_app'`. */
    app_id: number | null;
    /** True iff we have an encrypted PEM on file. The PEM itself is never exposed to clients. */
    has_app_private_key: boolean;
    /** Account login the App is installed on. Populated only when `kind = 'github_app'`. */
    app_installation_owner: string | null;
    /** Cached after the first `GET /users/{owner}/installation`. */
    app_installation_id: number | null;
    /** App slug (e.g. `atlas-app-bot`). Used to compose the bot's
     *  git commit identity. Null until populated from `app-config.json`
     *  or backfilled from `GET /app`. */
    app_slug: string | null;
    /** Human's display name (`sspart`). When set on a github_app
     *  credential, `Co-Authored-By: <human_name> <human_email>` is
     *  appended to every commit via a per-run `prepare-commit-msg` hook.
     *  Null → bot-only attribution. */
    human_name: string | null;
    /** Human's email. See `human_name`. */
    human_email: string | null;
    /** Human's GitHub login (`sspartorg`, without `@`). Used for
     *  `gh pr create --assignee <login>` and the `Requested-By: @<login>`
     *  first line of every PR body. Null → no PR assignee, no
     *  Requested-By prefix. */
    human_gh_login: string | null;
    created_at: string;
    updated_at: string;
}

export interface IEpic {
    id: string;
    project_id: string;
    title: string;
    description: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority;
    /** Task 1 — free-form labels for filtering. Max 20 per item / 40 chars each (enforced at Zod). */
    labels: string[];
    created_at: string;
    updated_at: string;
}

export interface IEpicListItem extends IEpic {
    story_count: number;
}

export interface IStory {
    id: string;
    epic_id: string;
    title: string;
    description: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority;
    spec_md: string | null;
    pr_url: string | null;
    points: number;
    acceptance_criteria: string;
    /** Task 1 — see IEpic. */
    labels: string[];
    // T2 — per-item git worktree association. PO Writer fills
    // `worktree_branch` (`atlas/<role>/<id>`); the worktree-orchestrator
    // resolves and writes back `worktree_path`. Both null on legacy items.
    worktree_branch: string | null;
    worktree_path: string | null;
    created_at: string;
    updated_at: string;
}

export interface ISubTask {
    id: string;
    story_id: string;
    title: string;
    description: string;
    status: SubTaskStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority;
    acceptance_criteria: string;
    started_at: string | null;
    /** Task 1 — see IEpic. */
    labels: string[];
    // T2 — see IStory for semantics.
    worktree_branch: string | null;
    worktree_path: string | null;
    created_at: string;
    updated_at: string;
}

export interface ISubBug {
    id: string;
    story_id: string;
    title: string;
    description: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority;
    acceptance_criteria: string;
    steps_to_reproduce: string;
    expected: string;
    actual: string;
    frequency: BugFrequency;
    failure_scope: BugFailureScope;
    detected_at: string | null;
    occurrence_count: number;
    occurrence_total: number;
    /** Task 1 — see IEpic. */
    labels: string[];
    // T2 — see IStory for semantics.
    worktree_branch: string | null;
    worktree_path: string | null;
    created_at: string;
    updated_at: string;
}

export interface IBug {
    id: string;
    epic_id: string;
    title: string;
    description: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority;
    acceptance_criteria: string;
    steps_to_reproduce: string;
    expected: string;
    actual: string;
    frequency: BugFrequency;
    failure_scope: BugFailureScope;
    detected_at: string | null;
    occurrence_count: number;
    occurrence_total: number;
    /** Task 1 — see IEpic. */
    labels: string[];
    // T2 — see IStory for semantics.
    worktree_branch: string | null;
    worktree_path: string | null;
    created_at: string;
    updated_at: string;
}

// ── Issue tree (composite endpoint) ───────────────────────────────────────
// One round-trip view of the workspace for the /issues page. The server
// assembles it via SQL JOINs / batched IN-list reads; the client renders
// the tree directly without per-resource fetches.
export type IssueTreeKind = 'story' | 'bug' | 'sub_task' | 'sub_bug';

export interface IIssueTreeNode {
    id: string;
    kind: IssueTreeKind;
    short_id: string;
    title: string;
    status: IssueStatus | SubTaskStatus;
    assignee_agent_id: string | null;
    reporter_agent_id: string | null;
    created_at: string;
    updated_at: string;
    // Ancestor identifiers + display labels (denormalised so the row can
    // render without follow-up lookups).
    project_id: string;
    project_name: string;
    epic_id: string | null;
    epic_title: string | null;
    parent_story_id: string | null;
    parent_story_title: string | null;
    // Sub-tasks / sub-bugs nested under a story. Empty array for leaf rows.
    children: IIssueTreeNode[];
}

export interface IIssueTreeResponse {
    projects: IProject[];
    agents: IAgent[];
    tree: IIssueTreeNode[];
    // Raw rows for callers that need the full per-kind shape (Project
    // Detail's EpicsTab, tab-count labels, derived `activeAgents`). The
    // tree builder already loads every item in the scope, so populating
    // these arrays is a project of the same query — no extra round-trip.
    // For the Issues page (which only renders `tree`), they're a few
    // extra bytes but already cached client-side, so net-net a single
    // /api/issues/tree fetch replaces three separate /api/{epics,
    // stories, bugs}?project_id=… calls on Project Detail.
    epics: IEpic[];
    stories: IStory[];
    bugs: IBug[];
}

// ── Composite "full" responses for detail pages ──────────────────────────
// Each detail page (story, bug, sub-task, sub-bug, epic) gets one of these
// via `GET /api/<kind>/:id/full`. Ancestors, children, related items,
// activity and the agent dictionary are all assembled server-side so the
// page renders from one HTTP round-trip.

export interface IStoryFullResponse {
    story: IStory;
    epic: IEpic | null;
    project: IProject | null;
    sub_tasks: ISubTask[];
    sub_bugs: ISubBug[];
    related_links: IIssueLinkRow[];
    external_links: IItemExternalLink[];
    activity: IActivityItem[];
    agents: IAgent[];
    /**
     * A04 — CLI invocations the currently-assigned agent has run against
     * this item. Null when no agent is assigned (Owner is the assignee)
     * or when the agent has not yet kicked off its first CLI. UI compares
     * against `agents[assignee].max_rounds` to render `Rounds: N / M` on
     * the detail rail.
     */
    round_count: number | null;
}

export interface IBugFullResponse {
    bug: IBug;
    epic: IEpic | null;
    project: IProject | null;
    related_links: IIssueLinkRow[];
    external_links: IItemExternalLink[];
    activity: IActivityItem[];
    agents: IAgent[];
    /** A04 — see IStoryFullResponse.round_count for semantics. */
    round_count: number | null;
}

export interface ISubTaskFullResponse {
    sub_task: ISubTask;
    parent_story: IStory | null;
    epic: IEpic | null;
    project: IProject | null;
    related_links: IIssueLinkRow[];
    external_links: IItemExternalLink[];
    activity: IActivityItem[];
    agents: IAgent[];
    /** A04 — see IStoryFullResponse.round_count for semantics. */
    round_count: number | null;
}

export interface ISubBugFullResponse {
    sub_bug: ISubBug;
    parent_story: IStory | null;
    epic: IEpic | null;
    project: IProject | null;
    related_links: IIssueLinkRow[];
    external_links: IItemExternalLink[];
    activity: IActivityItem[];
    agents: IAgent[];
    /** A04 — see IStoryFullResponse.round_count for semantics. */
    round_count: number | null;
}

export interface IEpicFullResponse {
    epic: IEpic;
    project: IProject | null;
    stories: IStory[];
    bugs: IBug[];
    related_links: IIssueLinkRow[];
    external_links: IItemExternalLink[];
    activity: IActivityItem[];
    agents: IAgent[];
    /** A04 — see IStoryFullResponse.round_count for semantics. */
    round_count: number | null;
}

// ── A12 — Reply-to-item with linked context ──────────────────────────────
// `replyToItem` MCP tool / `/api/issues/:type/:id/reply-context` route returns
// IReplyContext: the item, its full comment thread (head + tail with middle
// elided when the thread is over budget), every linked item (depends_on
// entries get description + acceptance_criteria + their last N comments
// inlined; relates_to stays shallow), and a slice of recent activity events.
// `replyToItem` with a body returns IReplyResponse — the new comment plus the
// context envelope visible at post time.

/**
 * The comment thread for the item being replied to. Long threads are
 * compacted via head + tail elision so the envelope stays under
 * `IReplyContext.budget_cap` tokens. `elided_count` is 0 when no
 * compaction was needed.
 */
export interface IReplyContextThread {
    comments: IComment[];
    elided_count: number;
    total_count: number;
}

/**
 * One linked item attached to the reply target, enriched with the data
 * the calling LLM needs to reply intelligently about a dependency or
 * related item without a follow-up MCP call.
 *
 * For `relation_type === 'depends_on'` entries, the assembler inlines
 * the linked item's `description` + `acceptance_criteria` and its last
 * N comments. For `'relates_to'` entries it stays shallow (title +
 * status only) — the assembler returns `description: null`,
 * `acceptance_criteria: null`, and an empty `recent_comments` array
 * to match the precedent set by `buildLinkedItemsSection` in the
 * prompt-builder.
 */
export interface IReplyContextLinkedItem {
    id: number;
    relation_type: 'depends_on' | 'relates_to' | 'tested_by';
    direction: 'outgoing' | 'incoming';
    type: IssueType;
    item_id: string;
    short_id: string;
    title: string;
    status: IssueStatus;
    description: string | null;
    acceptance_criteria: string | null;
    recent_comments: IComment[];
}

export interface IReplyContext {
    item: {
        kind: IssueType;
        id: string;
        title: string;
        status: IssueStatus;
        summary: string | null;
    };
    project: { id: string; name: string } | null;
    thread: IReplyContextThread;
    linked_items: IReplyContextLinkedItem[];
    activity_highlights: IActivityItem[];
    /**
     * Rough character-based estimate of the rendered envelope size
     * (`Math.ceil(chars / 4)`). Bounded by `budget_cap`; if the
     * pre-budget assembly was larger, the thread + linked-item comments
     * were elided to bring it under. No `tiktoken` dependency.
     */
    token_estimate: number;
    budget_cap: number;
}

export interface IReplyResponse {
    comment: IComment;
    context: IReplyContext;
}

export interface IAgentRun {
    id: string;
    agent_id: string;
    issue_type: IssueType;
    issue_id: string;
    /**
     * Theme 09b — project-scope runs (AI-Readiness Agent) carry
     * `project_id` with `issue_type`/`issue_id` null. Item-attached
     * + freedom-mode runs leave this null. No FK so historical rows
     * survive project deletion.
     */
    project_id: string | null;
    status: RunStatus;
    prompt_snapshot: string | null;
    output_text: string | null;
    started_at: string | null;
    completed_at: string | null;
    /**
     * Links a re-spawned run (e.g. an inter-agent on-fail bounce) to its
     * parent. NULL on every standalone run. Self-referential FK with
     * `ON DELETE CASCADE` so deleting a parent run cleans the thread.
     */
    parent_run_id: string | null;
    /**
     * 2026-06-10 — captured stdout+stderr from the per-project setup
     * script when it exits non-zero / times out / references an
     * unknown `${variable.KEY}`. NULL on runs that never invoked the
     * setup step or where it succeeded. Surfaced on the run-detail
     * page when `status === 'setup_failed'`.
     */
    setup_output_text: string | null;
    /**
     * Task 12 — unified outcome reported by every agent (regardless of
     * "role") via the fenced `atlas-outcome` block at the end of its
     * CLI output. The runner parses the block on completion and writes
     * these four columns; NULL on all four means the agent produced
     * unparseable output and is treated as `'asked_question'`.
     */
    outcome_kind: RunOutcomeKind | null;
    outcome_summary: string | null;
    outcome_reason: string | null;
    outcome_checklist: IRunOutcomeChecklistItem[] | null;
    created_at: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    total_cost_usd: number | null;
    /**
     * Plan B (Owner request 2026-06-01) — Copilot CLI native cost unit.
     * Equal to `usage.premiumRequests` from Copilot's `--output-format
     * json` `result` event (count of model API calls). Null on Claude
     * runs. The web run-detail card renders this as a subscript under
     * `total_cost_usd` so the Owner sees both the dollar estimate and
     * the underlying credit count.
     */
    credits: number | null;
    /**
     * Joined from `items.title` so run-history surfaces (project recent
     * activity, agent runs tab) can render "MON-3 · Fix login redirect"
     * without an extra round-trip. NULL on freedom-mode / project-scope
     * runs (no attached item) and on rows whose item was deleted.
     */
    item_title: string | null;
}

export interface ICostSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    run_count: number;
}

// Manual terminal session aggregate — parallels ICostSummary so KPI
// surfaces can report combined (agentic + terminal) spend without the
// caller juggling two unrelated shapes. `session_count` replaces
// `run_count`; the underlying source is `cli_sessions` rather than
// `agent_runs`.
export interface ITerminalCostSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    session_count: number;
}

export interface ISettings {
    id: number;
    owner_name: string;
    workspace_path: string;
    constitution_md: string;
    external_notification_provider: ExternalNotificationProvider;
    // Batch-9 audit: `external_notification_token` and
    // `external_notification_webhook_url` are ALWAYS null on the GET
    // /api/settings response. The `_set` booleans below tell the UI
    // whether a value is configured; the plaintext is fetched
    // on-demand via POST /api/settings/external-notification/reveal-*.
    external_notification_token: string | null;
    external_notification_chat_id: string | null;
    external_notification_webhook_url: string | null;
    /** true when a token is stored (encrypted) in the settings row. */
    external_notification_token_set?: boolean;
    /** true when a webhook URL is stored (encrypted) in the settings row. */
    external_notification_webhook_url_set?: boolean;
    onboarding_complete: number;
    accent_color: string;
    external_notification_event_toggles: string;
    quiet_hours_from: string | null;
    quiet_hours_to: string | null;
    quiet_hours_timezone: string | null;
    // 1 = quiet hours active, 0 = disabled. Distinct from from/to nullness
    // so the UI can toggle without wiping the saved time window.
    quiet_hours_enabled: number;
    external_notification_last_test_ok: number | null; // 1 = ok, 0 = failed, null = untested
    external_notification_endpoint_label: string | null; // e.g. "@bot_handle" — channel-agnostic label of the configured endpoint
    guardrails_published_at: string | null; // updated by POST /api/guardrails/save
    // Seconds of total silence (no PTY output, no user keystrokes) before
    // a Terminal session fires a 'waiting for input' notification.
    // Default 300 (5 min); editable in Settings → Notifications.
    terminal_idle_notify_seconds: number;
    created_at: string;
    updated_at: string;
    // Reflects ATLAS_AI_ENABLED env var at read time; never persisted.
    ai_enabled: boolean;
}

export interface ICliModel {
    id: string;
    cli: AgentCli;
    model_name: string;
    note: string | null;
    sort_order: number;
    created_at: string;
}

export interface IToolCatalogEntry {
    tool_name: string;
    group_name: string;
    description: string;
    sort_order: number;
}

export interface IEnvVar {
    key: string;
    value: string;
    secret: boolean;
    restart_required: boolean;
    description: string;
}

export interface IToolCatalogGroup {
    group_name: string;
    tools: Array<{ tool_name: string; description: string }>;
}

export type ExternalNotificationProvider = 'telegram' | 'teams';

export type ExternalNotificationEventKey =
    | 'item.status_changed:waiting_for_info'
    | 'item.status_changed:in_review'
    | 'agent.failed'
    | 'agent.run_finished_no_item'
    | 'terminal.waiting_for_input';

export const EXTERNAL_NOTIFICATION_EVENT_KEYS: ExternalNotificationEventKey[] = [
    'item.status_changed:waiting_for_info',
    'item.status_changed:in_review',
    'agent.failed',
    'agent.run_finished_no_item',
    'terminal.waiting_for_input',
];

export const EXTERNAL_NOTIFICATION_EVENT_LABELS: Record<ExternalNotificationEventKey, { title: string; sub: string }> = {
    'item.status_changed:waiting_for_info': {
        title: 'Waiting for Info',
        sub: 'item.status_changed → Waiting for Info',
    },
    'item.status_changed:in_review': {
        title: 'In Review',
        sub: 'item.status_changed → In Review · agent output ready for owner sign-off',
    },
    'agent.failed': {
        title: 'Agent Failed',
        sub: 'agent.failed · run errored or returned non-zero',
    },
    'agent.run_finished_no_item': {
        title: 'Agent Run Finished (no item)',
        sub: 'agent.run_finished_no_item · freedom-mode run completed or errored without producing an item',
    },
    'terminal.waiting_for_input': {
        title: 'Terminal: Waiting for Input',
        sub: 'terminal.waiting_for_input · session has been idle longer than the configured threshold',
    },
};

export interface IComment {
    id: number;
    author: 'owner' | 'agent';
    agent_id: string | null;
    issue_type: IssueType;
    issue_id: string;
    body: string;
    /**
     * Non-null when this comment was edited after creation; rendered as
     * a small "edited" badge next to the timestamp in the activity feed.
     * Each edit overwrites the body and re-stamps this value. There is no
     * version history.
     */
    edited_at: string | null;
    created_at: string;
}

export interface IIssueLink {
    id: number;
    from_type: IssueType;
    from_id: string;
    to_type: IssueType;
    to_id: string;
    created_at: string;
}

// External (off-platform) link attached to an item. Today only PR URLs land
// here; the schema's CHECK constraint will be relaxed to add new kinds.
export type ExternalLinkKind = 'pull_request';

export const EXTERNAL_LINK_KINDS: ExternalLinkKind[] = ['pull_request'];

export interface IItemExternalLink {
    id: number;
    item_id: string;
    link_kind: ExternalLinkKind;
    url: string;
    title: string | null;
    /** Human-readable identifier parsed from the URL (e.g. PR number). */
    external_ref: string | null;
    created_at: string;
    /** When set, points at the agent_runs row that opened the link. */
    created_by_run_id: string | null;
}

/** A link enriched with the target item's display info, for the UI list. */
export interface IIssueLinkRow {
    id: number;
    /** The end of the link the caller is *not* on (i.e. the related item). */
    type: IssueType;
    item_id: string;
    short_id: string;
    title: string;
    status: IssueStatus;
    // Differentiates "blocked by / blocks" links (depends_on) from generic
    // related items (relates_to) and dev↔QA twins (tested_by). The route
    // returns this per routes/comments.ts; the UI partitions on it to
    // render the appropriate section.
    relation_type: 'relates_to' | 'depends_on' | 'tested_by';
    /**
     * For directed relations (`depends_on`, `tested_by`): whether the
     * link's *from* endpoint is the caller (`outgoing`) or the related
     * item (`incoming`). For undirected `relates_to`, the API always
     * normalises to `outgoing`. The UI uses this to flip section titles
     * (e.g. "Tested by" on a dev story vs. "Tests" on a QA twin).
     */
    direction: 'outgoing' | 'incoming';
    created_at: string;
}

export type IssueEventType =
    | 'created'
    | 'status_changed'
    | 'assigned'
    | 'field_updated'
    | 'comment_added'
    | 'link_created'
    | 'link_deleted'
    | 'rounds_reset'
    | 'dispatch_blocked'
    | 'deleted'
    // 2026-07-03 audit round 2 — audit trail for the MCP `remove_history`
    // action. Emitted by historyPruneService.pruneBefore inside the same
    // transaction as the bulk DELETE so the destructive operation stays
    // traceable (was previously undetectable after commit — the very
    // issue_events rows that would record it were what got wiped).
    | 'history_pruned';
export type IssueEventField =
    | 'status'
    | 'assignee'
    | 'title'
    | 'description'
    | 'reporter'
    | 'spec_md'
    | 'pr_url'
    | 'points'
    | 'acceptance_criteria'
    | 'priority'
    | 'steps_to_reproduce'
    | 'expected'
    | 'actual'
    | 'frequency'
    | 'failure_scope'
    | 'link'
    | 'external_link'
    | 'git_push'
    | 'repo_exec'
    | null;

export interface IIssueEvent {
    id: number;
    issue_type: IssueType;
    issue_id: string;
    event_type: IssueEventType;
    actor_agent_id: string | null;
    field: IssueEventField;
    from_value: string | null;
    to_value: string | null;
    detail: string | null;
    created_at: string;
}

export type IActivityItem =
    | { kind: 'comment'; data: IComment }
    | { kind: 'event'; data: IIssueEvent };

export type NotificationKind = 'needs_you' | 'update' | 'system';
export type NotificationDeliveryStatus = 'none' | 'pending' | 'sent' | 'failed';
export type PushDeliveryStatus = 'none' | 'pending' | 'sent' | 'failed';

export interface INotification {
    id: number;
    event_type: string;
    message: string;
    issue_type: IssueType | null;
    issue_id: string | null;
    project_id: string | null;
    sent_external: number;
    kind: NotificationKind;
    agent_id: string | null;
    external_status: NotificationDeliveryStatus;
    failure_reason: string | null;
    push_status: PushDeliveryStatus;
    push_failure_reason: string | null;
    read_at: string | null;
    /** Optional deep-link target. When set, both the web-push click handler
     *  and the in-app notification row navigate here instead of deriving
     *  the URL from issue_type/issue_id. Lets callers route to surfaces
     *  that aren't Atlas items (Terminal sessions, etc.). */
    link_url: string | null;
    created_at: string;
}

export interface IPushSubscription {
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
    created_at: string;
    last_seen_at: string;
}

export type GuardrailCategory =
    | 'file_system'
    | 'secrets_credentials'
    | 'git_branches'
    | 'side_effects_network'
    | 'escalation_scope';

export type GuardrailSeverity = 'block' | 'ask_owner' | 'warn';

export interface IGuardrailRule {
    id: string;
    category: GuardrailCategory;
    rule_text: string;
    detail: string | null;
    severity: GuardrailSeverity;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface IProjectGuardrail {
    id: string;
    project_id: string;
    title: string;
    body_md: string;
    icon: string;
    enabled: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

/**
 * Phase 1.5b — Scripts are first-class entities, NOT properties of a
 * rule. Owner authors a script with a name + description + paired
 * bash + PowerShell bodies. Orchestrator emits each script as
 * `.atlas/scripts/{bash,powershell}/check-<id>.{sh,ps1}` at run time.
 *
 * No coupling to rules — the LLM-judged Articles half (`IGuardrailRule`)
 * and the machine-judged Scripts half (`IGuardrailScript`) compose
 * independently into the constitution.
 */
export interface IGuardrailScript {
    id: string;
    name: string;
    description: string;
    body_sh: string;
    body_ps1: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface IProjectGuardrailScript {
    id: string;
    project_id: string;
    name: string;
    description: string;
    body_sh: string;
    body_ps1: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface IAgentHandoffRule {
    id: number;
    agent_id: string;
    /** Empty string or `"owner"` means "hand back to the Owner". */
    target_agent_id: string;
    kind: AgentHandoffKind;
    /** Status to set on the item once the handoff lands. */
    status: IssueStatus;
}

/**
 * Pre-handoff checklist item. The agent must self-verify each `required: true`
 * item before invoking the handoff. Renderable as a checkbox in the Handoffs
 * tab; semantic enforcement is up to the agent runner.
 */
export interface IAgentChecklistItem {
    id: number;
    agent_id: string;
    label: string;
    sort_order: number;
    required: boolean;
}

export interface IAgentPromptVersion {
    id: number;
    agent_id: string;
    version: number;
    body_md: string;
    edited_by: string;
    reverted_from: number | null;
    created_at: string;
}

export type AgentMemorySource = 'ai-generated' | 'manual-edit';

export interface IAgentMemory {
    agent_id: string;
    body_md: string;
    version: number;
    source: AgentMemorySource;
    last_run_id: string | null;
    /**
     * Theme 08 — increments per completed/errored run (errors count
     * double). When this reaches `agents.memory_cadence`, the orchestrator
     * regenerates and resets to 0.
     */
    runs_since_regen: number;
    updated_at: string;
}

// Theme 08 — RAG + memory regenerations audit.

export type MemoryRegenerationTrigger = 'manual' | 'cadence' | 'high_signal' | 'mcp_update';

export type MemoryBoundaryFlag = 'item_id' | 'agent_id' | 'project_id' | 'run_id';

export interface IMemoryRegeneration {
    id: number;
    agent_id: string;
    /** Null for manual regenerations not bound to a run. */
    run_id: string | null;
    trigger: MemoryRegenerationTrigger;
    prev_version: number;
    new_version: number;
    prev_body_hash: string;
    new_body_hash: string;
    chars_added: number;
    chars_removed: number;
    /**
     * A06 — soft filter for boundary-rule violations in the newly-written
     * body. Empty array when the memory is clean. Persisted on every audit
     * row (manual / cadence / high_signal / mcp_update); the Memory tab
     * renders an amber chip on the history row when non-empty.
     */
    boundary_flags: MemoryBoundaryFlag[];
    created_at: string;
}

// Theme 11 — SDLC commit discipline audit.
export type CommitVerificationResult = 'compliant' | 'partial' | 'silent' | 'clean';

export interface ICommitProblem {
    commit_sha?: string;
    reason: string;
}

export interface ICommitVerification {
    id: number;
    run_id: string;
    item_id: string | null;
    agent_id: string;
    result: CommitVerificationResult;
    commit_count: number;
    problems: ICommitProblem[];
    checked_at: string;
}

export interface SSEEvent {
    type:
        | 'agent_status'
        | 'agent_output'
        | 'run_completed'
        | 'run_error'
        | 'run_queued'
        // 2026-06-10 — the per-project setup script exited non-zero,
        // timed out, or referenced an unknown `${variable.KEY}`. Run
        // is finalized with `agent_runs.status='setup_failed'` and no
        // CLI is spawned. Web UI shows a distinct amber affordance and
        // links to `setup_output_text` for the captured stdout/stderr.
        | 'run_setup_failed'
        | 'clone_status'
        | 'clone_output'
        | 'clone_completed'
        | 'clone_error'
        | 'delete_status'
        | 'delete_output'
        | 'delete_completed'
        | 'delete_error'
        | 'reclone_status'
        | 'reclone_output'
        | 'reclone_completed'
        | 'reclone_error'
        | 'autofetch_status'
        | 'autofetch_output'
        | 'autofetch_completed'
        | 'autofetch_error'
        | 'counts_changed'
        | 'notification_created'
        | 'notification_updated'
        | 'dry_run_started'
        | 'dry_run_output'
        | 'dry_run_done'
        | 'memory_regenerated'
        | 'commit_verification'
        // 2026-06-22 — Terminal v1. Session lifecycle events.
        // PTY byte stream goes over a dedicated WebSocket, NOT over SSE.
        | 'cli_session_status'
        | 'cli_session_closed';
    agentId?: string;
    runId?: string;
    /** Theme 08 — payload field carried by `memory_regenerated`. */
    memoryRegenerationTrigger?: MemoryRegenerationTrigger;
    /** Theme 08 — new memory version after a `memory_regenerated`. */
    memoryVersion?: number;
    /** Theme 11 — result of a `commit_verification` SSE event. */
    commitVerificationResult?: CommitVerificationResult;
    issueType?: IssueType;
    issueId?: string;
    status?: RunStatus | CloneStatus | 'starting' | 'fetching' | 'merging' | 'skipped';
    output?: string;
    cloneId?: string;
    deleteId?: string;
    recloneId?: string;
    autofetchId?: string;
    dryRunId?: string;
    stream?: 'stdout' | 'stderr';
    exitCode?: number;
    projectId?: string;
    mode?: 'unregister' | 'purge';
    stashPath?: string | null;
    result?: ScheduleRunStatus;
    detail?: string | null;
    project?: IProject;
    errorDetail?: string;
    /** W4 — typed kind on `run_error` SSE events. Lets the UI render a
     *  kind-aware banner (e.g. "claude CLI not on PATH") instead of dumping
     *  the raw error string. Undefined on non-error events and on errors
     *  the runner couldn't classify. */
    errorKind?: ApiErrorKind;
    /** W4 — optional structured context that pairs with `errorKind`. */
    errorDetails?: unknown;
    /** 2026-06-10 — typed kind on `run_setup_failed` SSE events.
     *  `unknown_secret` (placeholder references a missing key),
     *  `nonzero` (script exited with non-zero exit code),
     *  `timeout` (script exceeded ATLAS_SETUP_TIMEOUT_MS),
     *  `spawn_failed` (couldn't launch the script process at all). */
    setupFailedKind?: 'unknown_secret' | 'nonzero' | 'timeout' | 'spawn_failed';
    notificationId?: number;
    notificationKind?: NotificationKind;
    scope?: 'sidenav' | 'dashboard';
    timestamp?: string;
    // 2026-06-22 — Terminal v1 SSE payload fields.
    cliSessionId?: string;
    cliSessionStatus?: CliSessionStatus;
    cliSessionFinalizePrUrl?: string | null;
}

export type SchedulePreset = 'hourly' | 'every_4h' | 'daily' | 'weekly' | 'custom';
export type ScheduleConflictPolicy = 'skip' | 'stash' | 'abort';
export type ScheduleRunStatus = 'success' | 'skipped' | 'failure' | 'conflict';

export interface IProjectSchedule {
    project_id: string;
    enabled: boolean;
    preset: SchedulePreset;
    cron_expression: string;
    time_of_day: string;
    weekday: number | null;
    skip_if_dirty: boolean;
    pause_while_agents_active: boolean;
    conflict_policy: ScheduleConflictPolicy;
    last_run_at: string | null;
    last_run_status: ScheduleRunStatus | null;
    last_run_detail: string | null;
    next_run_at: string | null;
    auth_failure_count: number;
    created_at: string;
    updated_at: string;
}

// Theme 07 — reminder runtime. The MCP `setReminder` tool inserts a row;
// `agent-schedule-registry.tick()` fires due rows as external notifications
// + in-app notification + SSE.
export type ReminderScheduleKind = 'once' | 'daily' | 'weekly' | 'cron';
export type ReminderChannel = 'external' | 'notification' | 'both';
export type ReminderStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export type ReminderSchedule =
    | { kind: 'once'; at: string }
    | { kind: 'daily'; time_of_day: string }
    | { kind: 'weekly'; weekdays: number[]; time_of_day: string }
    | { kind: 'cron'; expr: string };

export interface IReminder {
    id: number;
    label: string;
    body: string;
    schedule_kind: ReminderScheduleKind;
    /**
     * Encoded schedule payload, format depends on `schedule_kind`:
     *   once   -> ISO datetime
     *   daily  -> 'HH:MM'
     *   weekly -> '<HH:MM>|<weekdays-comma-sep-ISO-1-7>'
     *   cron   -> cron expression
     */
    schedule_value: string;
    channel: ReminderChannel;
    next_fire_at: string;
    last_fired_at: string | null;
    created_by_agent_id: string | null;
    status: ReminderStatus;
    created_at: string;
    updated_at: string;
}

// P12 — Scratch Pad. A free-form markdown-tile workspace for the Owner;
// stored in the `scratch_pad` table. id is a client-minted string (ULID-ish)
// so the route handler accepts an explicit id from the create payload,
// matching how items and projects are minted.
export interface IScratchPad {
    id: string;
    title: string;
    body_md: string;
    created_at: string;
    updated_at: string;
}

// 2026-06-22 — Terminal v1. PTY-backed interactive Claude Code sessions
// hosted in the web app. A session owns a project-scoped worktree + branch
// and a Claude CLI session_id (minted by us via `--session-id <uuid>` at
// spawn). PTY bytes stream over WS (`/api/cli/sessions/:id/stream`); SSE
// only carries metadata-change events for cache invalidation.
export type CliSessionStatus = 'active' | 'paused' | 'closed' | 'errored';

export interface ICliSession {
    id: string;
    project_id: string;
    title: string;
    status: CliSessionStatus;
    /** Which CLI this session is running. `claude` supports `--resume`; `copilot` does not. */
    cli: 'claude' | 'copilot';
    worktree_path: string | null;
    worktree_branch: string | null;
    /** Only set for `claude` sessions — minted via `--session-id` for `--resume`. Null for copilot. */
    claude_session_id: string | null;
    model: string;
    initial_prompt: string | null;
    created_at: string;
    updated_at: string;
    last_active_at: string;
    closed_at: string | null;
    finalize_pr_url: string | null;
    /** Optional Atlas item this session is helping with. Null = project-scoped only. */
    item_id: string | null;
    /**
     * Token + USD cost columns. Populated at session close for Claude PTY
     * sessions by summing per-event `usage` blocks in the ingested JSONL
     * transcript and multiplying by the model pricing table (see api
     * `pty-transcript-usage.ts` + `claude-model-pricing.ts`). Null for
     * copilot rows — copilot's `events.jsonl` doesn't carry equivalent
     * per-event token data, so cost for copilot terminals is deferred.
     * `cache_creation_tokens` is the SUM of ephemeral_5m + ephemeral_1h
     * cache writes; the per-tier split lives only in the JSONL itself.
     */
    total_cost_usd: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
}

export interface CliSessionCreateInput {
    project_id: string;
    /** Defaults to `Session <short-id>` server-side if omitted. */
    title?: string;
    /** Defaults to `atlas/terminal/<short-id>` server-side if omitted. */
    branch_name?: string;
    /** Optional first prompt sent to the PTY after a settle delay. */
    initial_prompt?: string;
    /** Defaults to the per-CLI default model server-side if omitted. */
    model?: string;
    /** Optional Atlas item id to anchor this session to. Must belong to the same project. */
    item_id?: string;
    /** Which CLI to spawn. Defaults to `claude` server-side. */
    cli?: 'claude' | 'copilot';
}

/** One entry from `git status --porcelain -z` in the session worktree. */
export interface CliSessionUnstagedFile {
    /** Two-char porcelain code, e.g. ` M`, `??`, `A `, `MM`. */
    code: string;
    /** Path relative to the worktree root. */
    path: string;
}

export interface CliSessionPreflightStopResponse {
    unstaged: CliSessionUnstagedFile[];
    current_branch: string;
    /** Number of local commits ahead of `origin/<branch>` (0 if remote tracking absent). */
    ahead_of_remote: number;
}

/** GET /api/cli/sessions/:id/transcript response — only valid for closed/errored sessions. */
export interface ICliSessionTranscriptResponse {
    /** Full JSONL file content from the CLI's on-disk session state. Null if unavailable. */
    jsonl_content: string | null;
    /** ISO timestamp of the last on-disk read, or null if never ingested. */
    ingested_at: string | null;
    /** Which CLI produced this transcript; the viewer dispatches on this. */
    source: 'claude' | 'copilot';
}

export interface CliSessionStopInput {
    /** Paths to `git add` before commit. Empty array = no commit, just push + teardown. */
    files_to_stage: string[];
    /** Required only if `files_to_stage` is non-empty. */
    commit_message?: string;
    /**
     * Open a pull request after a successful push. Defaults to `true`
     * server-side, so callers that predate this field keep the original
     * auto-PR behaviour. `false` still pushes the branch — the worktree is
     * torn down immediately after close, so skipping the push would destroy
     * the work. It only suppresses PR creation (and, with it, the
     * `item_external_links` row that records the PR URL).
     */
    open_pull_request?: boolean;
}

export interface CliSessionStopResponse {
    session: ICliSession;
    pushed: boolean;
    committed: boolean;
    finalize_pr_url: string | null;
}

// 2026-08-04 — Terminal finalize diff. The Stop modal reviews two scopes,
// which together are exactly what the PR will contain:
//   `uncommitted` — working tree vs HEAD; these are the stageable files.
//   `committed`   — HEAD vs the merge-base with the project's default branch;
//                   work already committed inside the session, read-only.
export type CliSessionDiffScopeName = 'uncommitted' | 'committed';

/** One changed file in one scope. */
export interface CliSessionDiffFile {
    /** Repo-relative, forward slashes. The POST-image (new) path for renames. */
    path: string;
    /** Pre-image path when `status` is `renamed` or `copied`; else null. */
    old_path: string | null;
    status:
        | 'added'
        | 'modified'
        | 'deleted'
        | 'renamed'
        | 'copied'
        | 'type_changed'
        | 'untracked';
    /**
     * Two-char `git status --porcelain` code (` M`, `??`, `MM`, `A `). Only
     * the uncommitted scope has index/worktree columns, so this is null for
     * the committed scope.
     */
    code: string | null;
    /** Lines added. 0 when `binary`. */
    additions: number;
    /** Lines removed. 0 when `binary`. */
    deletions: number;
    binary: boolean;
    /** Over the per-file size cap — the patch endpoint returns `patch: null`. */
    too_large: boolean;
}

export interface CliSessionDiffScope {
    files: CliSessionDiffFile[];
    /** Files git reported BEFORE the server-side cap; may exceed `files.length`. */
    total_files: number;
    truncated: boolean;
    /** Sums across the UNCAPPED set, so the header stat stays honest. */
    additions: number;
    deletions: number;
}

/** GET /api/cli/sessions/:id/diff */
export interface CliSessionDiffSummaryResponse {
    uncommitted: CliSessionDiffScope;
    committed: CliSessionDiffScope;
    current_branch: string;
    /** Ref the merge-base came from (`origin/main`, `main`, …). Null if none resolved. */
    base_ref: string | null;
    /** 40-hex merge-base commit. Null when `base_ref` is null. */
    base_sha: string | null;
    commits_ahead_of_base: number;
}

/** GET /api/cli/sessions/:id/diff/file */
export interface CliSessionFilePatchResponse {
    path: string;
    scope: CliSessionDiffScopeName;
    /** Raw unified diff. Null when `binary` or `truncated`. */
    patch: string | null;
    binary: boolean;
    truncated: boolean;
    /** Byte size of the patch git produced, even when `patch` is null. */
    byte_size: number;
}

// W4 — Typed API error envelope. Every non-2xx response from @atlas/api
// SHOULD carry an ApiErrorBody. Legacy callers that send `{ error: '…' }`
// alone are still tolerated; the web client defaults `kind` to
// 'internal_error' when missing so round-trip back-compat holds.
export type ApiErrorKind =
    | 'unauthorized'           // missing/bad MCP token
    | 'credentials_missing'    // user hasn't configured this integration yet
    | 'credentials_invalid'    // creds present but rejected by upstream (Jira/OpenAI/etc.)
    | 'rate_limited'           // upstream returned 429
    | 'upstream_unavailable'   // upstream returned 5xx or connection refused (covers MCP server down)
    | 'cli_not_installed'      // `claude` / `copilot` binary not on PATH (ENOENT)
    | 'validation_error'       // request didn't parse
    | 'not_found'              // GET on missing id
    | 'conflict'               // unique constraint, status transition, depends_on block, etc.
    | 'internal_error';        // catch-all — bug, fix and reclassify next time

export interface ApiErrorBody {
    error: string;       // human one-liner (back-compat with existing { error } responses)
    kind: ApiErrorKind;  // machine code (new)
    details?: unknown;   // optional structured context (e.g. which binary is missing)
}

// ── Marketplace ──────────────────────────────────────────────────────────────
//
// The marketplace catalog is an immutable-from-the-runtime-perspective list of
// shareable agents. Catalog content lives on disk under
// `packages/api/src/marketplace/catalog/<id>/`; the seed script loads it into
// the `marketplace_agents` table, bumping `version` whenever the canonical
// content hash changes. Local agents carry an optional soft back-link
// (IAgent.marketplace_source_id) so the UI can surface "upgrade available"
// when the catalog has moved on.

export interface IMarketplaceAgent {
    id: string;
    name: string;
    category: AgentCategory;
    cli: AgentCli;
    model: string;
    effort: AgentEffort;
    framework: string;
    prompt_md: string;
    handoff_prompt_md: string;
    description: string;
    designation: string;
    accent_color: string;
    sort_order: number;
    glyph: string;
    role_id: SdlcRole | null;
    max_rounds: number;
    requires_item: boolean;
    requires_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    status: AgentStatus;
    kind_slug: AgentKindSlug;
    settings_json: Record<string, unknown>;
    schedule_hours: number;
    schedule_preset: AgentSchedulePreset;
    schedule_time_of_day: string | null;
    schedule_weekdays: number[] | null;
    schedule_day_of_month: number | null;
    cron_expr: string | null;
    concurrent_runs: number;
    memory_cadence: number;
    /** Optional starter memory body. Most catalog entries ship empty. */
    memory_template_md: string;
    /** Short blurb shown on marketplace cards. */
    summary: string;
    /** Monotonic integer bumped by the seed when content_hash changes. */
    version: number;
    published_at: string;
    updated_at: string;
}

/** Lightweight projection returned by list / search endpoints + MCP. */
export interface IMarketplaceAgentSummary {
    id: string;
    name: string;
    category: AgentCategory;
    kind_slug: AgentKindSlug;
    summary: string;
    accent_color: string;
    glyph: string;
    version: number;
    /** Whether some local agent has marketplace_source_id === this id.
     *  Detached agents (source_id NULL) are NOT counted. */
    is_installed: boolean;
    /** @deprecated Equal to `is_installed`; kept on the shape for one
     *  release for back-compat. New code should use `is_installed`. */
    is_linked: boolean;
    /** The local agent's id when installed, null otherwise. May differ
     *  from `id` (the catalog id) when the user picked a custom slug on
     *  install — the frontend must use this to navigate to the agent's
     *  detail page, NOT the catalog id. */
    installed_agent_id: string | null;
    /** The linked local agent's pulled_version, null when not installed. */
    installed_version: number | null;
    /** True when installed AND installed_version < version. */
    upgrade_available: boolean;
}

export interface IMarketplaceAgentHandoff {
    target_agent_id: string;
    kind: AgentHandoffKind;
    status: IssueStatus;
}

export interface IMarketplaceAgentChecklist {
    label: string;
    sort_order: number;
    required: boolean;
}

/** Full composite returned by GET /api/marketplace/agents/:id + MCP. */
export interface IMarketplaceAgentFull {
    agent: IMarketplaceAgent;
    handoff_rules: IMarketplaceAgentHandoff[];
    checklists: IMarketplaceAgentChecklist[];
}

/** Per-field diff returned by POST /api/marketplace/agents/:id/diff/:agent_id. */
export interface IMarketplaceUpgradeDiff {
    marketplace_id: string;
    local_agent_id: string;
    marketplace_version: number;
    local_pulled_version: number | null;
    fields: {
        prompt_md: { from: string; to: string; changed: boolean };
        handoff_prompt_md: { from: string; to: string; changed: boolean };
        settings_json: {
            from: Record<string, unknown>;
            to: Record<string, unknown>;
            changed: boolean;
        };
        handoff_rules: {
            from: IMarketplaceAgentHandoff[];
            to: IMarketplaceAgentHandoff[];
            changed: boolean;
        };
        checklists: {
            from: IMarketplaceAgentChecklist[];
            to: IMarketplaceAgentChecklist[];
            changed: boolean;
        };
    };
}

export type MarketplaceUpgradeField =
    | 'prompt_md'
    | 'handoff_prompt_md'
    | 'settings_json'
    | 'handoff_rules'
    | 'checklists';

/** Body of POST /api/agents/:id/accept-upgrade. */
export interface IAcceptUpgradeRequest {
    fields: MarketplaceUpgradeField[];
}

/** Manifest JSON inside an agent export zip. Round-trips with the catalog. */
export interface IAgentBundleManifest {
    /** Catalog/agent id (kebab slug). */
    id: string;
    name: string;
    category: AgentCategory;
    cli: AgentCli;
    model: string;
    effort: AgentEffort;
    framework: string;
    description: string;
    designation: string;
    accent_color: string;
    sort_order: number;
    glyph: string;
    role_id: SdlcRole | null;
    max_rounds: number;
    requires_item: boolean;
    requires_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    status: AgentStatus;
    kind_slug: AgentKindSlug;
    settings_json: Record<string, unknown>;
    schedule_hours: number;
    schedule_preset: AgentSchedulePreset;
    schedule_time_of_day: string | null;
    schedule_weekdays: number[] | null;
    schedule_day_of_month: number | null;
    cron_expr: string | null;
    concurrent_runs: number;
    memory_cadence: number;
    handoff_prompt_md: string;
    summary: string;
    version: number;
    published_at: string;
}
