import { z } from 'zod';
import { AGENT_KIND_SLUGS } from '../types/index.js';
import { AGENT_CLIS } from '../cli/index.js';
import { normalizeStatusInput } from '../status-machine/index.js';

export const AgentCliSchema = z.enum(AGENT_CLIS);
export const AgentStatusSchema = z.enum(['active', 'inactive']);
export const AgentCategorySchema = z.enum(['software-dev', 'marketing', 'content', 'design']);
// Task 6 — reasoning-effort knob. Both `claude` and `copilot` CLIs accept
// `--effort` / `--reasoning-effort` with this exact value set (verified
// live via `copilot --help` and code.claude.com/docs/en/cli-reference).
// Stored per-agent; threaded into the spawn args in agent-runner.ts.
export const AgentEffortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
export const AgentKindSlugSchema = z.enum(
    AGENT_KIND_SLUGS as readonly [(typeof AGENT_KIND_SLUGS)[number], ...(typeof AGENT_KIND_SLUGS)[number][]],
);

// A08 — SDLC role catalog enum. Must stay in sync with `SdlcRole` and
// `SDLC_ROLES` in types/index.ts and the seed rows in migration 025.
export const SdlcRoleSchema = z.enum([
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
]);

// A08 — `PATCH /api/roles/:id` body. Edits only the default prompt
// (and the optional description). `default_status` and `sort_order` are
// catalog-shape fields, not Owner-tunable knobs; changing those would
// need a migration. The catalog id is the URL parameter, not the body.
export const UpdateRoleSchema = z
    .object({
        default_prompt_md: z.string().max(100_000).optional(),
        description: z.string().max(2000).optional(),
        label: z.string().min(1).max(80).optional(),
    })
    .strict();
export const IssueTypeSchema = z.enum(['epic', 'story', 'sub_task', 'sub_bug', 'bug']);
// Must match the DB CHECK constraint on `agent_runs.status` (see migration
// 005_environment_secrets_and_setup_runner.ts which added `setup_failed`)
// AND the RunStatus type in ../types/index.ts. Previously the enum was
// stuck at the pre-setup-runner five-value shape; any route or service
// using this schema to validate rows or filter params would reject
// legitimate `setup_failed` rows.
export const RunStatusSchema = z.enum([
    'queued',
    'in_progress',
    'completed',
    'error',
    'cancelled',
    'setup_failed',
]);

export const IssueStatusSchema = z.enum([
    'draft',
    'ready',
    'in_progress',
    'waiting_for_info',
    'in_review',
    'done',
]);

// Sub-tasks share the unified status enum. Keep this export as an alias so
// existing import sites stay valid.
export const SubTaskStatusSchema = IssueStatusSchema;

export const IssuePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const BugFrequencySchema = z.enum(['always', 'sometimes', 'rare']);
export const BugFailureScopeSchema = z.enum(['data-loss', 'functional', 'cosmetic', 'performance']);

export const AgentHandoffKindSchema = z.enum(['on-pass', 'on-fail']);

export const AgentSchedulePresetSchema = z.enum([
    'every_n_hours',
    'daily',
    'weekly',
    'monthly',
]);

// HH:MM in 24-hour, e.g. '09:00', '23:59'. Stored as text in PG.
const TimeOfDayRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

// ISO weekdays 1..7 (Mon=1 .. Sun=7), 1-7 distinct entries.
const AgentWeekdaysSchema = z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((arr) => new Set(arr).size === arr.length, {
        message: 'schedule_weekdays must be distinct',
    });

/**
 * Cross-field validation for the agent schedule combo. Accepts an object
 * with `schedule_preset` plus the preset-specific fields and enforces that
 * the right fields are present for the chosen preset:
 *
 * - every_n_hours: schedule_hours required (> 0 ≤ 168)
 * - daily:        schedule_time_of_day required
 * - weekly:       schedule_time_of_day + schedule_weekdays required
 * - monthly:      schedule_time_of_day + schedule_day_of_month required (1..31)
 *
 * Apply via `.superRefine(applyAgentScheduleRefinement)` on a parent schema
 * that carries all five fields as optional. Empty input (no preset given)
 * passes — the service layer defaults `schedule_preset='every_n_hours'`
 * and `schedule_hours=6` when both are absent.
 */
export function applyAgentScheduleRefinement(
    data: {
        schedule_preset?: 'every_n_hours' | 'daily' | 'weekly' | 'monthly' | undefined;
        schedule_hours?: number | undefined;
        schedule_time_of_day?: string | null | undefined;
        schedule_weekdays?: number[] | null | undefined;
        schedule_day_of_month?: number | null | undefined;
    },
    ctx: z.RefinementCtx,
): void {
    const preset = data.schedule_preset;
    if (preset === undefined) return;
    if (preset === 'every_n_hours') {
        if (data.schedule_hours === undefined || data.schedule_hours <= 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['schedule_hours'],
                message: 'schedule_hours required (>0) when preset is every_n_hours',
            });
        }
        return;
    }
    if (!data.schedule_time_of_day || !TimeOfDayRegex.test(data.schedule_time_of_day)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['schedule_time_of_day'],
            message: `schedule_time_of_day required (HH:MM) when preset is ${preset}`,
        });
    }
    if (preset === 'weekly') {
        const days = data.schedule_weekdays;
        const parsed = AgentWeekdaysSchema.safeParse(days);
        if (!parsed.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['schedule_weekdays'],
                message: 'schedule_weekdays required (1-7 distinct ISO weekdays) when preset is weekly',
            });
        }
    }
    if (preset === 'monthly') {
        const d = data.schedule_day_of_month;
        if (d === undefined || d === null || !Number.isInteger(d) || d < 1 || d > 31) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['schedule_day_of_month'],
                message: 'schedule_day_of_month required (1..31) when preset is monthly',
            });
        }
    }
}

export const AgentHandoffRuleInputSchema = z.object({
    target_agent_id: z.string(),
    kind: AgentHandoffKindSchema,
    status: IssueStatusSchema,
});

export const AgentChecklistItemInputSchema = z.object({
    label: z.string().min(1).max(500),
    sort_order: z.number().int().default(0),
    required: z.boolean().default(true),
});

const AgentCoreFieldsSchema = {
    name: z.string().min(1).max(100),
    category: AgentCategorySchema,
    cli: AgentCliSchema,
    model: z.string().min(1),
    // Task 6 — reasoning-effort knob. Required with a sensible default so
    // every agent record carries one value; spawn args pick it up
    // unconditionally for both CLIs.
    effort: AgentEffortSchema.default('medium'),
    framework: z.string().default(''),
    prompt_md: z.string().default(''),
    handoff_prompt_md: z.string().default(''),
    status: AgentStatusSchema.optional(),
    accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    sort_order: z.number().int().default(0),
    description: z.string().default(''),
    designation: z.string().default(''),
    // A08 — Foreign key into the SDLC role catalog. Optional; autonomous
    // agents leave this null and rely on `kind_slug` instead.
    role_id: SdlcRoleSchema.nullable().optional(),
    max_rounds: z.number().int().min(1).max(20).default(5),
    requires_item: z.boolean().default(true),
    schedule_hours: z.number().nonnegative().optional(),
    schedule_preset: AgentSchedulePresetSchema.optional(),
    schedule_time_of_day: z.string().regex(TimeOfDayRegex).nullable().optional(),
    schedule_weekdays: AgentWeekdaysSchema.nullable().optional(),
    schedule_day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    concurrent_runs: z.number().int().nonnegative().optional(),
    glyph: z.string().default(''),
    // Plan E — when true, orchestrator opens a PR at run-end.
    raises_pr: z.boolean().optional(),
    // Plan #7 — when true, orchestrator pushes the worktree branch to
    // origin at run-end. Independent of raises_pr.
    push_code: z.boolean().optional(),
    // When true, orchestrator provisions an isolated worktree before
    // dispatch. Required for any agent that commits code OR needs branch
    // isolation from the user's clone.
    requires_worktree: z.boolean().optional(),
    // Theme 09 — autonomous-agent archetype tag. 'custom' for user-created.
    kind_slug: AgentKindSlugSchema.optional(),
    // Theme 09 — JSONB blob of per-archetype config. Unstructured at the
    // boundary; per-kind shape lives in @atlas/shared/agents/settings-schemas
    // and is validated by the service layer when appropriate.
    settings_json: z.record(z.string(), z.unknown()).optional(),
    // Optional croner-compatible cron expression. When non-null and non-empty,
    // overrides schedule_preset in the scheduler. Length-capped to 200 to keep
    // the payload sane; the service layer parses the value via croner and
    // rejects expressions that croner can't interpret.
    cron_expr: z.string().max(200).nullable().optional(),
};

const AgentNestedChildrenSchema = {
    handoff_rules: z.array(AgentHandoffRuleInputSchema).optional(),
    checklists: z.array(AgentChecklistItemInputSchema).optional(),
};

export const CreateAgentSchema = z
    .object({
        id: z.string().min(1).optional(),
        ...AgentCoreFieldsSchema,
        ...AgentNestedChildrenSchema,
    })
    .superRefine(applyAgentScheduleRefinement);

export const UpdateAgentSchema = z
    .object({
        name: z.string().min(1).max(100).optional(),
        category: AgentCategorySchema.optional(),
        cli: AgentCliSchema.optional(),
        model: z.string().min(1).optional(),
        effort: AgentEffortSchema.optional(),
        framework: z.string().optional(),
        prompt_md: z.string().optional(),
        handoff_prompt_md: z.string().optional(),
        status: AgentStatusSchema.optional(),
        accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        sort_order: z.number().int().optional(),
        description: z.string().optional(),
        // T1 — Reviewer side of each SDLC role lives on its own dedicated
        // agent record now; no bundled reviewer prompt field here.
        designation: z.string().optional(),
        // A08 — Re-pointing an agent at a different SDLC role. Set to null
        // to detach (treats the agent as autonomous-style with no role).
        role_id: SdlcRoleSchema.nullable().optional(),
        max_rounds: z.number().int().min(1).max(20).optional(),
        requires_item: z.boolean().optional(),
        schedule_hours: z.number().nonnegative().optional(),
        schedule_preset: AgentSchedulePresetSchema.optional(),
        schedule_time_of_day: z.string().regex(TimeOfDayRegex).nullable().optional(),
        schedule_weekdays: AgentWeekdaysSchema.nullable().optional(),
        schedule_day_of_month: z.number().int().min(1).max(31).nullable().optional(),
        concurrent_runs: z.number().int().nonnegative().optional(),
        glyph: z.string().optional(),
        // Theme 08 — per-agent memory regeneration cadence (run count
        // before automatic regen fires). DB CHECK enforces 1..100.
        memory_cadence: z.number().int().min(1).max(100).optional(),
        // Plan E — toggle orchestrator-driven PR creation for this agent.
        raises_pr: z.boolean().optional(),
        // Plan #7 — toggle orchestrator-driven push at run-end.
        push_code: z.boolean().optional(),
        // Toggle worktree provisioning for this agent.
        requires_worktree: z.boolean().optional(),
        // Theme 09 — autonomous-agent archetype tag. Boundary-unstructured.
        kind_slug: AgentKindSlugSchema.optional(),
        // Theme 09 — JSONB blob of per-archetype config; unstructured here.
        settings_json: z.record(z.string(), z.unknown()).optional(),
        // Optional croner-compatible cron expression. When non-null and
        // non-empty, overrides schedule_preset. Length-capped to 200; the
        // service layer parses via croner and rejects unparseable values.
        cron_expr: z.string().max(200).nullable().optional(),
        ...AgentNestedChildrenSchema,
    })
    .strict()
    .superRefine(applyAgentScheduleRefinement);

export const AgentHandoffRulesPutSchema = z.object({
    rules: z.array(AgentHandoffRuleInputSchema),
});

export const AgentChecklistsPutSchema = z.object({
    items: z.array(AgentChecklistItemInputSchema),
});

export const AgentMemorySourceSchema = z.enum(['ai-generated', 'manual-edit']);

// `mode` lets the MCP `updateAgentMemory` tool either overwrite the
// full body (`'replace'`, default) or surgically append a lesson under
// `## Course corrections` (`'append'`).
export const AgentMemoryUpdateSchema = z.object({
    body_md: z.string().max(100_000),
    mode: z.enum(['replace', 'append']).default('replace'),
});

// Theme 08 — RAG audit / index surfaces.
export const MemoryRegenerationTriggerSchema = z.enum([
    'manual',
    'cadence',
    'high_signal',
    'mcp_update',
]);

export const RunAgentSchema = z.object({
    agent_id: z.string().min(1),
    issue_type: IssueTypeSchema,
    issue_id: z.string().min(1),
});

export const IssueKeyPrefixSchema = z
    .string()
    .regex(/^[A-Z]{3}$/, 'Issue key prefix must be exactly 3 uppercase letters');

// Follow-up audit: bring Create* schemas to `.strict()` parity with their
// Update* siblings so unknown keys become 400s at the boundary instead of
// being silently dropped by Zod's default `.strip()`. A typo like
// `assigne_agent_id` in a client payload would otherwise 200-succeed with
// the field never landing — insidious drift bug that shows up as "the
// server just isn't saving my change" with no error surface.
export const CreateProjectSchema = z
    .object({
        name: z.string().min(1).max(200),
        issue_key_prefix: IssueKeyPrefixSchema,
        git_path: z.string().default(''),
        description: z.string().default(''),
        status: z.string().default('active'),
    })
    .strict();

export const UpdateProjectSchema = z
    .object({
        name: z.string().min(1).max(200).optional(),
        git_path: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.string().min(1).optional(),
        guardrails_md: z.string().optional(),
        // 2026-06-10 — Per-project setup script bodies. Owner edits via
        // the Setup tab on Project Detail; orchestrator will execute at
        // worktree provisioning time in a follow-up. Empty string clears.
        setup_sh_body: z.string().optional(),
        setup_ps1_body: z.string().optional(),
    })
    .strict();

// Task 1 — labels reused across every item create/update schema. Cap of
// 20 labels per item, 40 chars each — enforced at the route layer
// because every storage path goes through these schemas.
export const ItemLabelsSchema = z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .default([]);
export const ItemLabelsOptionalSchema = z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional();

export const CreateEpicSchema = z
    .object({
        project_id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().default(''),
        priority: IssuePrioritySchema.default('normal'),
        reporter_agent_id: z.string().nullable().default(null),
        assignee_agent_id: z.string().nullable().default(null),
        labels: ItemLabelsSchema,
    })
    .strict();

export const UpdateEpicSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        reporter_agent_id: z.string().nullable().optional(),
        labels: ItemLabelsOptionalSchema,
    })
    .strict();

export const CreateStorySchema = z
    .object({
        epic_id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().default(''),
        acceptance_criteria: z.string().default(''),
        priority: IssuePrioritySchema.default('normal'),
        status: IssueStatusSchema.optional(),
        assignee_agent_id: z.string().nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        labels: ItemLabelsSchema,
    })
    .strict();

// T2 — `worktree_branch` follows the canonical `atlas/<role>/<id>`
// shape PO Writer is contracted to write. The regex matches the same
// pattern the orchestrator validates against in
// `packages/api/src/services/worktree-orchestrator.ts` (kept in
// lockstep — change one, change the other).
export const WORKTREE_BRANCH_RE_SOURCE = '^atlas/[a-z][a-z0-9-]*/[A-Za-z0-9._-]+$';
const WORKTREE_BRANCH_SCHEMA = z.string().regex(new RegExp(WORKTREE_BRANCH_RE_SOURCE));

export const UpdateStorySchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        acceptance_criteria: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        spec_md: z.string().nullable().optional(),
        pr_url: z.string().nullable().optional(),
        points: z.number().int().optional(),
        // T2 — PO Writer fills this on every dev/QA story it creates so
        // the non-AI worktree orchestrator can provision the on-disk
        // checkout. Owner can override the value through the same
        // PATCH; null clears it (legacy items).
        worktree_branch: WORKTREE_BRANCH_SCHEMA.nullable().optional(),
        labels: ItemLabelsOptionalSchema,
    })
    .strict();

export const CreateSubTaskSchema = z
    .object({
        story_id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().default(''),
        acceptance_criteria: z.string().default(''),
        priority: IssuePrioritySchema.default('normal'),
        status: SubTaskStatusSchema.optional(),
        assignee_agent_id: z.string().nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        labels: ItemLabelsSchema,
    })
    .strict();

export const UpdateSubTaskSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        acceptance_criteria: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        labels: ItemLabelsOptionalSchema,
    })
    .strict();

const BugFieldsSchema = {
    acceptance_criteria: z.string().default(''),
    steps_to_reproduce: z.string().default(''),
    expected: z.string().default(''),
    actual: z.string().default(''),
    frequency: BugFrequencySchema.default('sometimes'),
    failure_scope: BugFailureScopeSchema.default('cosmetic'),
};

const BugUpdateFieldsSchema = {
    acceptance_criteria: z.string().optional(),
    steps_to_reproduce: z.string().optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    frequency: BugFrequencySchema.optional(),
    failure_scope: BugFailureScopeSchema.optional(),
};

export const CreateSubBugSchema = z
    .object({
        story_id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().default(''),
        ...BugFieldsSchema,
        priority: IssuePrioritySchema.default('normal'),
        status: IssueStatusSchema.optional(),
        assignee_agent_id: z.string().nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        labels: ItemLabelsSchema,
    })
    .strict();

export const UpdateSubBugSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        ...BugUpdateFieldsSchema,
        labels: ItemLabelsOptionalSchema,
    })
    .strict();

export const CreateBugSchema = z
    .object({
        epic_id: z.string().min(1),
        title: z.string().min(1).max(500),
        description: z.string().default(''),
        ...BugFieldsSchema,
        priority: IssuePrioritySchema.default('normal'),
        status: IssueStatusSchema.optional(),
        assignee_agent_id: z.string().nullable().optional(),
        reporter_agent_id: z.string().nullable().optional(),
        labels: ItemLabelsSchema,
    })
    .strict();

export const UpdateBugSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        priority: IssuePrioritySchema.optional(),
        ...BugUpdateFieldsSchema,
        labels: ItemLabelsOptionalSchema,
    })
    .strict();

export const CreateIssueLinkSchema = z.object({
    to_type: IssueTypeSchema,
    to_id: z.string().min(1),
    // Optional in the body — route defaults to `relates_to` when omitted.
    // `tested_by` is directed (from = QA story, to = dev story) and is
    // intended for PO Writer / agents, not the user-facing add-link picker.
    relation_type: z.enum(['relates_to', 'depends_on', 'tested_by']).optional(),
});

// External link (off-platform URL) attached to an item. Today only PR URLs
// are wired up; the link_kind enum is the schema's expansion seam — relax
// the CHECK constraint + add the value here when adding a new kind.
export const CreateItemExternalLinkSchema = z.object({
    link_kind: z.enum(['pull_request']),
    url: z.string().url().max(2_000),
    // Optional metadata. The orchestrator passes the title it fetched via
    // `gh pr view`; manual UI submissions can leave it null and the server
    // attempts a best-effort `gh pr view` lookup.
    title: z.string().max(500).nullable().optional(),
});

export const CreateCommentSchema = z.object({
    author: z.enum(['owner', 'agent']),
    agent_id: z.string().nullable().default(null),
    issue_type: IssueTypeSchema,
    issue_id: z.string().min(1),
    body: z.string().min(1),
});

export const UpdateCommentSchema = z.object({
    body: z.string().min(1).max(50_000),
});

// A12 — POST /api/issues/:type/:id/reply body. `author` defaults to 'owner'
// because the canonical caller is the Owner posting via an external Claude /
// MCP-aware CLI. Agents posting through the runner already use the
// commentsService.create() path directly; they can still call this endpoint
// with `author: 'agent', agent_id: '...'` if they want context loaded.
export const ReplyToItemSchema = z
    .object({
        body: z.string().min(1),
        author: z.enum(['owner', 'agent']).optional().default('owner'),
        agent_id: z.string().nullable().optional().default(null),
    })
    .refine((v) => v.author !== 'agent' || !!v.agent_id, {
        message: "agent_id is required when author === 'agent'",
        path: ['agent_id'],
    });

// POST /api/issues/:type/:id/history/prune body. Agents that manage a
// long-lived tracking item (e.g. cer-weekly-automation on JDA-1) invoke
// this via the MCP `update_item` action `remove_history` to drop stale
// comments + issue_events older than a cutoff timestamp. `before_time`
// is an ISO 8601 datetime — everything strictly before it is deleted,
// regardless of author. The row exactly at the boundary is preserved.
export const PruneItemHistorySchema = z.object({
    before_time: z.string().datetime({ offset: true }),
});

export const OnboardingSchema = z.object({
    owner_name: z.string().min(1).max(100),
    workspace_path: z.string().min(1),
});

// `requested_by_agent_id` lets agent-driven assignments stamp the
// activity-log row with the calling agent's id instead of leaving it
// null (which made the UI fall back to the API token's owner — so
// `agent-po-reviewer` reassigning to QA Writer showed up as
// "sspart assigned …"). Optional so manual / Owner-side calls can omit it.
export const AssignSchema = z.object({
    assignee_agent_id: z.string().nullable(),
    requested_by_agent_id: z.string().min(1).optional(),
});

// 2026-06-09 — accept either the canonical enum form (`ready`,
// `in_review`, etc.) OR the human-readable label form (`Ready`,
// `In Review`, etc., matching `getStatusLabel` output). LLM-driven
// callers (Copilot via `handoff.md`) tend to apply semantic priors and
// emit the human label even when the prompt says enum; normalizing here
// lets either form succeed and lands the canonical enum downstream.
// Invalid values surface as a Zod issue → 400 with a list of valid
// names. See `normalizeStatusInput` in status-machine.
export const TransitionStatusSchema = z.object({
    status: z.string().min(1).transform((value, ctx) => {
        const normalized = normalizeStatusInput(value);
        if (!normalized) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    `Unknown status "${value}". Valid values: ` +
                    'Draft, Ready, In Progress, In Review, Waiting for Info, Done ' +
                    '(case-insensitive; enum forms like "in_review" also accepted).',
            });
            return z.NEVER;
        }
        return normalized;
    }),
    requested_by_agent_id: z.string().min(1).optional(),
});

export const CredentialHostSchema = z.enum(['github']);
export const CredentialKindSchema = z.enum(['pat', 'github_app']);

// PAT branch — a long-lived Personal Access Token the user pasted in.
export const CreatePatCredentialSchema = z.object({
    label: z.string().min(1).max(80),
    host: CredentialHostSchema.default('github'),
    kind: z.literal('pat').default('pat'),
    username: z.string().min(1).max(120).default('x-access-token'),
    token: z.string().min(8),
    scope: z.string().default(''),
    expires_at: z.string().nullable().default(null),
});

// github_app branch — points at a folder on the server containing an
// `app-config.json` (App id/slug) and a single `*.pem` (private key). The
// service reads and encrypts them; the caller never sends secrets over the
// wire (they already live on disk with 0600 perms per Create-App.ps1).
//
// human_name / human_email / human_gh_login are optional. Set them to
// co-author commits + assign PRs to a human developer alongside the bot.
// Leaving them blank keeps bot-only attribution (behaviour before
// migration 025 landed).
// human_* fields flow into shell (prepare-commit-msg hook) and markdown
// (PR body via `Requested-By: @<login>` prefix) contexts, so we reject
// control characters + newlines at the schema layer instead of relying
// on downstream escaping. Injection is not the only concern — a
// newline in human_name also breaks the `grep -qxF` idempotency check
// inside the commit-msg hook, so every amend stacks a duplicate trailer.
// human_gh_login is further constrained to GitHub's actual username
// grammar (alphanumeric + hyphen, non-hyphen ends, ≤39 chars) so the
// `--assignee` argv and the PR body prefix agree on what's valid.
//
// 2026-07-03 audit round 1 follow-up: extended to reject Unicode line
// separators U+2028 / U+2029 and the C1 control range U+0080-U+009F.
// Some trailer / activity-log parsers split on U+2028; a name like
// "Bob\u2028Attacker <evil@x>" would otherwise pass the ASCII-only
// filter and land as a two-line trailer visible to GitHub / gh.
const NO_CONTROL_CHARS = /^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/;
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export const CreateGithubAppCredentialSchema = z.object({
    label: z.string().min(1).max(80),
    host: CredentialHostSchema.default('github'),
    kind: z.literal('github_app'),
    bot_info_path: z.string().min(1).max(1024),
    app_installation_owner: z.string().min(1).max(120),
    scope: z.string().default(''),
    human_name: z
        .string()
        .min(1)
        .max(120)
        .regex(NO_CONTROL_CHARS, 'human_name may not contain newlines or control characters')
        .nullable()
        .optional(),
    human_email: z.string().email().max(200).nullable().optional(),
    human_gh_login: z
        .string()
        .min(1)
        .max(39)
        .regex(GITHUB_LOGIN_RE, 'human_gh_login must be a valid GitHub username')
        .nullable()
        .optional(),
});

// Wrap the discriminated union in a preprocessor that defaults `kind` to
// 'pat' when it's missing. Preserves back-compat with callers that were
// authored before the `github_app` kind existed (see `api.credentials.create`
// in `packages/web/src/api/api.ts`) and with the existing PAT test suite.
export const CreateCredentialSchema = z.preprocess((val) => {
    if (val && typeof val === 'object' && !('kind' in val)) {
        return { ...(val as Record<string, unknown>), kind: 'pat' };
    }
    return val;
}, z.discriminatedUnion('kind', [CreatePatCredentialSchema, CreateGithubAppCredentialSchema]));

// Updates only touch metadata that's safe to edit after creation. Tokens
// for PAT credentials are re-set via the same `token` field; App
// credentials have their tokens minted by the service, so the field is
// rejected by the service layer.
//
// Zod's default is to strip unknown keys, which is intentional here:
// callers that round-trip the whole ICredential row (label + host +
// kind + created_at + id + etc.) should get 200 OK with only the known
// mutable fields applied — same shape the pre-`github_app`-kind schema
// accepted.
export const UpdateCredentialSchema = z.object({
    label: z.string().min(1).max(80).optional(),
    username: z.string().min(1).max(120).optional(),
    token: z.string().min(8).optional(),
    scope: z.string().optional(),
    expires_at: z.string().nullable().optional(),
    app_installation_owner: z.string().min(1).max(120).optional(),
    // Migration 025 — human-attribution fields (github_app only).
    // `null` clears the value; omitting keeps existing. Same character-set
    // rules as create: no control chars, GitHub-login grammar for gh_login.
    human_name: z
        .string()
        .min(1)
        .max(120)
        .regex(NO_CONTROL_CHARS, 'human_name may not contain newlines or control characters')
        .nullable()
        .optional(),
    human_email: z.string().email().max(200).nullable().optional(),
    human_gh_login: z
        .string()
        .min(1)
        .max(39)
        .regex(GITHUB_LOGIN_RE, 'human_gh_login must be a valid GitHub username')
        .nullable()
        .optional(),
});

export const CloneProjectSchema = z.object({
    repo_url: z
        .string()
        .url()
        .refine((u) => u.startsWith('https://github.com/'), {
            message: 'Only https://github.com URLs are supported',
        }),
    credential_id: z.string().min(1),
    project_name: z.string().min(1).max(200),
    issue_key_prefix: IssueKeyPrefixSchema,
    default_branch: z.string().default('main'),
});

export const DeleteProjectSchema = z.object({
    mode: z.enum(['unregister', 'purge']),
    confirm_name: z.string().optional(),
});

export const RecloneProjectSchema = z.object({}).strict().optional().default({});

export const ConnectExistingProjectSchema = z.object({
    folder_path: z.string().min(1),
    repo_url: z
        .string()
        .url()
        .refine((u) => u.startsWith('https://github.com/'), {
            message: 'Only https://github.com URLs are supported',
        }),
    credential_id: z.string().min(1),
    issue_key_prefix: IssueKeyPrefixSchema,
});

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected hex color like #2E2E2E');
const HHMMSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24-hour required');

export const UpdateProfileSchema = z.object({
    owner_name: z.string().min(1).max(100).optional(),
    accent_color: HexColorSchema.optional(),
    workspace_path: z.string().min(1).optional(),
});

export const UpdateEnvSchema = z.object({
    updates: z
        .array(
            z.object({
                key: z
                    .string()
                    .min(1)
                    .regex(/^[A-Z][A-Z0-9_]*$/, 'Env var keys must be UPPER_SNAKE_CASE'),
                value: z.string(),
            })
        )
        .min(1),
});

export const CreateCliModelSchema = z.object({
    cli: AgentCliSchema,
    model_name: z.string().min(1).max(80),
    note: z.string().max(120).nullable().default(null),
});

export const UpdateCliModelSchema = z
    .object({
        note: z.string().max(120).nullable().optional(),
        sort_order: z.number().int().min(0).optional(),
    })
    .strict();

export const ExternalNotificationProviderSchema = z.enum(['telegram', 'teams']);

export const UpdateExternalNotificationSchema = z.object({
    external_notification_provider: ExternalNotificationProviderSchema.optional(),
    external_notification_token: z.string().nullable().optional(),
    external_notification_chat_id: z.string().nullable().optional(),
    external_notification_webhook_url: z.string().url().nullable().optional(),
});

export const UpdateNotificationsSchema = z.object({
    external_notification_event_toggles: z.record(z.string(), z.boolean()).optional(),
    quiet_hours_from: HHMMSchema.nullable().optional(),
    quiet_hours_to: HHMMSchema.nullable().optional(),
    quiet_hours_timezone: z.string().nullable().optional(),
    quiet_hours_enabled: z.coerce.number().int().min(0).max(1).optional(),
    // Terminal v2: idle-notification threshold in seconds. Clamped 60-3600
    // (1 min - 1 hr) to prevent both spam and silent forever-waits.
    terminal_idle_notify_seconds: z.coerce.number().int().min(60).max(3_600).optional(),
});

export const GuardrailCategorySchema = z.enum([
    'file_system',
    'secrets_credentials',
    'git_branches',
    'side_effects_network',
    'escalation_scope',
]);

export const GuardrailSeveritySchema = z.enum(['block', 'ask_owner', 'warn']);

export const CreateGuardrailRuleSchema = z.object({
    category: GuardrailCategorySchema,
    rule_text: z.string().min(1).max(500),
    detail: z.string().max(1000).nullable().default(null),
    severity: GuardrailSeveritySchema,
});

export const UpdateGuardrailRuleSchema = CreateGuardrailRuleSchema.partial();

export const CreateProjectGuardrailSchema = z.object({
    title: z.string().min(1).max(200),
    body_md: z.string().min(1).max(2000),
    icon: z.string().max(40).default('shield'),
    enabled: z.coerce.number().int().min(0).max(1).default(1),
    sort_order: z.number().int().default(0),
});

export const UpdateProjectGuardrailSchema = CreateProjectGuardrailSchema.partial();

// Phase 1.5b — Scripts are first-class. Each script row carries name,
// description, and the paired bash + powershell bodies. Both bodies
// are MANDATORY on create — a script is useless on one platform if
// it can't run on the other. Update is partial; the schema's refine
// enforces that whatever fields ARE supplied keep the both-non-empty
// invariant when either body field is touched.
//
// `id` is the kebab-case slug Owner supplies at create time. Agent
// prompts reference scripts by this exact id (e.g. `check-foo.sh
// <itemId>`), so the validator enforces a slug shape: lowercase a-z,
// digits, hyphens; must start with a letter or digit; no trailing
// hyphen. Slug is immutable after create — `UpdateGuardrailScriptSchema`
// is a partial of the create schema MINUS `id` via .omit().
export const CreateGuardrailScriptSchema = z.object({
    id: z
        .string()
        .min(1)
        .max(80)
        .regex(
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
            'Slug must be lowercase kebab-case (a-z, 0-9, hyphens); must start and end with a letter or digit.',
        ),
    name: z.string().min(1).max(120),
    description: z.string().max(500).default(''),
    body_sh: z.string().min(1).max(20000),
    body_ps1: z.string().min(1).max(20000),
    sort_order: z.number().int().default(0),
});

export const UpdateGuardrailScriptSchema = CreateGuardrailScriptSchema.omit({ id: true })
    .partial()
    .refine(
        (data) => {
            // If either body is being patched, BOTH must be patched
            // (both non-empty). Updating only one body leaves a script
            // in a half-platform state, which the contract forbids.
            const touchesSh = data.body_sh !== undefined;
            const touchesPs1 = data.body_ps1 !== undefined;
            if (!touchesSh && !touchesPs1) return true;
            if (touchesSh !== touchesPs1) return false;
            return !!data.body_sh?.trim() && !!data.body_ps1?.trim();
        },
        {
            message:
                'When updating script bodies, both .sh and .ps1 must be patched together and both must be non-empty.',
        },
    );

export const CreateProjectGuardrailScriptSchema = CreateGuardrailScriptSchema;
export const UpdateProjectGuardrailScriptSchema = UpdateGuardrailScriptSchema;

export const ToggleProjectGuardrailSchema = z.object({
    enabled: z.coerce.number().int().min(0).max(1),
});

export const NotificationKindSchema = z.enum(['needs_you', 'update', 'system']);
export const NotificationDeliveryStatusSchema = z.enum(['none', 'pending', 'sent', 'failed']);

export const NotificationFilterSchema = z.object({
    kind: NotificationKindSchema.optional(),
    external_status: NotificationDeliveryStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const SchedulePresetSchema = z.enum(['hourly', 'every_4h', 'daily', 'weekly', 'custom']);
export const ScheduleConflictPolicySchema = z.enum(['skip', 'stash', 'abort']);

export const ProjectScheduleSchema = z.object({
    enabled: z.boolean(),
    preset: SchedulePresetSchema,
    time_of_day: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24-hour required'),
    weekday: z.number().int().min(0).max(6).nullable(),
    cron_expression: z.string().min(1).max(120),
    skip_if_dirty: z.boolean(),
    pause_while_agents_active: z.boolean(),
    conflict_policy: ScheduleConflictPolicySchema,
});
export type ProjectScheduleInput = z.infer<typeof ProjectScheduleSchema>;

// Theme 07 — reminder schemas. ReminderScheduleSchema is a discriminated
// union; the runtime serializes to `schedule_value` per the convention
// documented on IReminder.
export const ReminderScheduleSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('once'), at: z.string().datetime() }),
    z.object({
        kind: z.literal('daily'),
        time_of_day: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24-hour required'),
    }),
    z.object({
        kind: z.literal('weekly'),
        weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
        time_of_day: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24-hour required'),
    }),
    z.object({ kind: z.literal('cron'), expr: z.string().min(1).max(200) }),
]);

export const ReminderChannelSchema = z.enum(['external', 'notification', 'both']);

export const SetReminderSchema = z.object({
    label: z.string().min(1).max(200),
    body: z.string().default(''),
    schedule: ReminderScheduleSchema,
    channel: ReminderChannelSchema.default('notification'),
    created_by_agent_id: z.string().nullable().optional(),
});
export type SetReminderInput = z.infer<typeof SetReminderSchema>;

export const CancelReminderSchema = z.object({
    id: z.number().int().positive(),
});

export const UpdateReminderSchema = z
    .object({
        label: z.string().min(1).max(200).optional(),
        body: z.string().optional(),
        schedule: ReminderScheduleSchema.optional(),
        channel: ReminderChannelSchema.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one field must be provided',
    });
export type UpdateReminderInput = z.infer<typeof UpdateReminderSchema>;

// P12 — Scratch Pad schemas. Free-form markdown tiles for the Owner. Title
// and body are both optional on create (a brand-new tile starts blank); the
// UI fills them in via autosave. Update is partial; at least one field
// required so PATCH with an empty body fails fast.
//
// `z.input` (vs `z.infer` which returns output) is the right shape for the
// callable surface — `.default('')` should not force callers to pass the
// field. The route still receives the parsed (output) shape with defaults
// filled in.
export const CreateScratchPadSchema = z.object({
    id: z.string().min(1).max(64).optional(),
    title: z.string().max(300).optional().default(''),
    body_md: z.string().max(100_000).optional().default(''),
});
export type CreateScratchPadInput = z.input<typeof CreateScratchPadSchema>;

export const UpdateScratchPadSchema = z
    .object({
        title: z.string().max(300).optional(),
        body_md: z.string().max(100_000).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one field must be provided',
    });
export type UpdateScratchPadInput = z.infer<typeof UpdateScratchPadSchema>;

// Terminal v2 — single source of truth for the CLI session create payload.
// Imported by both `packages/api/src/routes/cli-sessions.ts` (server-side
// validation) and `packages/web/src/pages/Terminal.tsx` (the StartSessionDialog
// builds payloads that have to satisfy this exact shape). `.strict()` rejects
// unknown fields so a TS-shaped drift between client and server gets caught
// at the API boundary instead of silently dropped.
export const CliSessionCreateSchema = z
    .object({
        project_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        branch_name: z.string().min(1).max(200).optional(),
        initial_prompt: z.string().max(8_000).optional(),
        model: z.string().min(1).max(80).optional(),
        item_id: z.string().min(1).max(200).optional(),
        cli: AgentCliSchema.default('claude'),
    })
    .strict();
