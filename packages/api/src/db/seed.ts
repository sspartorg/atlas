import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { db } from './kysely-client.js';
import { loadCatalog, type CatalogEntry } from '../marketplace/catalog-loader.js';
import { sourcesFor, type RegulationSource } from '../agents/sources/regulations-matrix.js';
import {
    PO_WRITER_PROMPT,
    CODER_PROMPT,
    QA_WRITER_PROMPT,
    ARCHITECT_PROMPT,
    AUTOMATION_PROMPT,
    PO_REVIEWER_PROMPT,
    CODE_REVIEWER_PROMPT,
    QA_REVIEWER_PROMPT,
    ARCHITECT_REVIEWER_PROMPT,
    AUTOMATION_REVIEWER_PROMPT,
} from './seeds/sdlc-roles.js';
// T1 — T0 (Wave 1) introduced 5 new reviewer agent records as siblings
// of the 5 performers. Performer rows carry `prompt_md = <role>_PROMPT`;
// each reviewer row picks up its own `_REVIEWER_PROMPT` directly into
// `prompt_md`. The runner treats both kinds the same (one CLI per run);
// what makes a reviewer "review" is its prompt + the on-pass / on-fail
// handoff wiring below.
import type { SdlcRole } from '@atlas/shared';

// Theme 09 — defensive boot check that the regulations matrix has
// at least one source per project_type × region we ship. Catches
// matrix typos in the seed module (which is exercised by `pnpm
// db:seed` on a fresh DB) rather than at agent dispatch time.
function assertRegulationsMatrixHealthy(): void {
    const sample: RegulationSource[] = sourcesFor('saas', 'EU');
    if (sample.length === 0) {
        throw new Error('regulations-matrix: saas:EU returned no sources');
    }
}

// Resolve prompt files relative to this seed module so the agent
// prompts can be diffed cleanly outside the seed source.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadPrompt(name: string): string {
    return readFileSync(resolve(__dirname, '..', 'agents', 'prompts', name), 'utf8');
}

// ─── Agent seed ──────────────────────────────────────────────────────────────
//
// Four production-grade agents. The handoff chain is intentionally linear:
//
//   PO Writer ──pass──▶ Spec Writer ──pass──▶ Coder ──pass──▶ QA Writer ──pass──▶ Owner
//        ▲                  │                   │                 │
//        └──fail── Spec ────┘                   │                 │
//                                 ──fail── Coder┘                 │
//                                                  ──fail── QA ───┘
//
// Each agent has its own checklist + allowed-tools set. The Owner mutates these
// via the four MCP tools (`listAgents`, `getAgent`, `createAgent`, `updateAgent`)
// rather than hand-editing this file.

interface AgentSeed {
    id: string;
    name: string;
    category: 'software-dev' | 'marketing' | 'content' | 'design';
    cli: 'claude' | 'copilot';
    model: string;
    framework: string;
    prompt_md: string;
    prompt_version: number;
    handoff_prompt_md: string;
    status: 'active' | 'inactive';
    accent_color: string;
    sort_order: number;
    description: string;
    designation: string;
    /**
     * A08 — FK into the SDLC role catalog. Optional: autonomous agents
     * (kind_slug != 'custom') leave this undefined and store NULL.
     */
    role_id?: SdlcRole;
    max_rounds: number;
    requires_item: boolean;
    schedule_hours?: number;
    /** A09 — preset-based scheduling for autonomous agents that fire at a
     *  specific wall-clock time (e.g. ai-news daily at 09:00). When set,
     *  the runtime ignores `schedule_hours` and uses preset math. */
    schedule_preset?: 'every_n_hours' | 'daily' | 'weekly' | 'monthly';
    schedule_time_of_day?: string;
    concurrent_runs: number;
    glyph: string;
    // Theme 09 — autonomous-agent metadata. Optional in the seed
    // interface so the existing 14 rows compile without churn; the
    // DB defaults handle missing fields on INSERT.
    kind_slug?: 'ai-news' | 'market-research' | 'regulations' | 'jira-to-epic' | 'ai-readiness' | 'knowledge-base' | 'custom';
    settings_json?: Record<string, unknown>;
    cron_expr?: string | null;
    // Plan E — orchestrator opens a PR at run-end when this is true and
    // the run pushed something. Default false; the three SDLC reviewers
    // flip it on below. No effect on autonomous agents (no worktree, no
    // branch, push step short-circuits).
    raises_pr?: boolean;
    // Plan #7 — orchestrator pushes the worktree branch to origin at
    // run-end when this is true. Default false (set by migration 066).
    // True for the six software-dev agents that commit code today;
    // false for PO Writer + the two read-only reviewers + every
    // non-SDLC utility agent.
    push_code?: boolean;
    // When true, orchestrator provisions an isolated worktree before
    // dispatch (item-attached uses item.worktree_branch; project-scope
    // gets atlas/<kind_slug|role_id|'run'>/<short-runId>). False ⇒ run
    // executes directly in project.git_path. Required for any agent
    // that commits code OR needs branch isolation from the user's clone.
    requires_worktree?: boolean;
}

interface HandoffRuleSeed {
    agent_id: string;
    target_agent_id: string;
    kind: 'on-pass' | 'on-fail';
    status: string;
}

interface ChecklistSeed {
    agent_id: string;
    label: string;
    sort_order: number;
    required: boolean;
}

// A08 — Prompt constants for the 4 active SDLC agents now live in
// `./seeds/sdlc-roles.ts` (single source of truth shared with migration
// 025 and the role catalog). Importing them keeps each agent row's
// `prompt_md` byte-equal to its role's default
// at install time. Owner edits via the Prompt tab continue to write
// only to the agent row — the role default stays put unless edited via
// `PATCH /api/roles/:id`.

export const AGENT_SEEDS: AgentSeed[] = [
    {
        id: 'agent-po-writer',
        name: 'PO Writer',
        category: 'software-dev',
        cli: 'claude',
        // Migration 045 walked the SDLC trio (PO / Architect / QA) back
        // off Opus 1M and onto Sonnet 4.6 — the spec-kit lifecycle is
        // doing the heavy reasoning downstream, so Sonnet is the right
        // tier here. Only AI Readiness keeps an Opus model now.
        model: 'claude-sonnet-4-6',
        framework: 'agile-po',
        prompt_version: 1,
        status: 'active',
        accent_color: '#007AC9',
        // Monotonic 1..11 sort order — see migration 041 for the
        // live-DB realignment. Order in the seed file mirrors the UI
        // order: PO → Architect → Coder → QA → Automation → Jira →
        // AI Readiness → AI News → Market Research → Regulations →
        // Knowledge Base.
        sort_order: 1,
        description:
            'Decomposes Epics into end-to-end functional Stories. v3 duplicates every dev story as a QA twin and links the pair via `tested_by` so the Architect picks up the dev side while QA Writer picks up the test side.',
        designation: 'Product Owner',
        role_id: 'po',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 3,
        concurrent_runs: 1,
        glyph: 'developer_board',
        prompt_md: PO_WRITER_PROMPT,
        handoff_prompt_md:
            'When you finish: the paired PO reviewer agent (`agent-po-reviewer`) grades your output against the checklist before the chain fans out to **Architect** (for the dev story) and **QA Writer** (for the QA twin). If a story is ambiguous, scope is too large, acceptance criteria are missing, or a dev story is missing its `tested_by` QA twin, comment on the item and exit — the reviewer agent escalates to the Owner with `waiting_for_info`.',
        requires_worktree: true,
    },
    // Spec Writer removed in P1 — `agent-spec-writer` is deleted by
    // migration 030. P2 promotes the merged Architect-cum-Spec-Writer
    // role on `agent-architect` instead.
    {
        // P3 — Coder v2 (spec-kit lifecycle + PR raise). Model flips to
        // `claude-sonnet-4-6` (Copilot CLI stays), schedule moves to
        // `every_n_hours` at 1 hour, `cron_expr` is null. Migration 034
        // reconciles existing installs.
        id: 'agent-coder',
        name: 'Coder',
        category: 'software-dev',
        cli: 'copilot',
        // Workstream #4 — Copilot CLI registry uses the dot form;
        // `cli_models` row is `claude-sonnet-4.6`. The hyphen form is
        // the Claude-CLI strain and never matched the copilot registry.
        model: 'claude-sonnet-4.6',
        framework: 'tdd-red-green-refactor',
        prompt_version: 1,
        status: 'active',
        accent_color: '#22A06B',
        sort_order: 3,
        description:
            "Picks up the dev Story Architect spec'd, reuses Architect's worktree, runs the spec-kit lifecycle (clarify/plan/task/implement/verify/analyze) committing each phase, raises a PR with `gh pr create`, comments the PR URL on the story, then removes the local worktree (remote branch survives as the PR head).",
        designation: 'Engineer',
        role_id: 'engineer',
        max_rounds: 5,
        requires_item: true,
        schedule_preset: 'every_n_hours',
        schedule_hours: 1,
        cron_expr: null,
        concurrent_runs: 1,
        glyph: 'terminal',
        prompt_md: CODER_PROMPT,
        handoff_prompt_md:
            'When you finish: the paired Code Reviewer agent (`agent-code-reviewer`) grades the PR diff against the checklist before the chain advances. If the Architect handoff is missing or the build is blocked, comment and exit so the reviewer agent escalates to the Owner.',
        push_code: true,
        requires_worktree: true,
    },
    {
        // P4 — QA Writer v2. Plans test cases as sub-tasks under a QA Story
        // (the `[QA]` twin PO Writer produced) — five kinds (API / UI / E2E
        // / Integration / Regression), each tagged `[automation_candidate]`
        // or `[manual_only]`. Cadence moved from 1h to 2h (twin items
        // don't need sub-hour scheduling). Migration 035 reconciled the
        // earlier model bump (Sonnet→Opus); migration 045 walked it back
        // to Sonnet 4.6 along with PO Writer + Architect — the spec-kit
        // lifecycle handles the deep reasoning downstream.
        id: 'agent-qa-writer',
        name: 'QA Writer',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: 'test-planning',
        prompt_version: 1,
        status: 'active',
        accent_color: '#A855F7',
        sort_order: 4,
        description:
            'Takes a QA Story (the `[QA]` twin from PO Writer) and files test-case sub-tasks across five kinds — API, UI, E2E, Integration, Regression — each tagged `[automation_candidate]` or `[manual_only]`. Plans tests; does not write or run them.',
        designation: 'Quality Assurance',
        role_id: 'qa',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 2,
        concurrent_runs: 1,
        glyph: 'verified',
        prompt_md: QA_WRITER_PROMPT,
        handoff_prompt_md:
            'When you finish: the paired QA reviewer agent (`agent-qa-reviewer`) counts sub-tasks per (criterion × applicable kind) and verifies the shape of each one. On pass, the chain returns the QA Story to the Owner for sign-off with status `in_review`. On fail (`insufficient_coverage` / `malformed_subtask` / `missing_tested_by_link`), the reviewer agent bounces back so you can fill the gaps.',
        push_code: true,
        requires_worktree: true,
    },
    // -------------------------------------------------------------------
    // Disabled SDLC swarm — Theme 06 seeds the broader roles in the
    // inactive state so the user can flip them on as needed. Prompts and
    // handoff rules are intentionally empty; the user fills them in (via
    // the agent maintenance UI) before activation. Scheduler ignores
    // inactive agents.
    // -------------------------------------------------------------------
    {
        // P2 — Architect-cum-Spec-Writer promoted to active. Picks up a
        // dev Story PO Writer produced, spawns a worktree off
        // origin/main, runs spec-kit (`specify init` + `specify specify
        // --idea`), hand-edits the generated spec.md to senior-engineer
        // quality, commits + pushes, comments branch + spec path on the
        // dev story, transitions to `ready_for_dev`, and hands off to
        // Coder (who reuses the worktree). Migration 033 reconciles
        // existing installs.
        id: 'agent-architect',
        name: 'Architect',
        category: 'software-dev',
        cli: 'claude',
        // SDLC trio sits on Sonnet 4.6 after migration 045. See PO Writer
        // for the rationale.
        model: 'claude-sonnet-4-6',
        framework: 'spec-kit',
        prompt_version: 1,
        status: 'active',
        accent_color: '#5B7CFA',
        sort_order: 2,
        description: 'Architect-cum-Spec-Writer. Takes a dev Story from PO Writer, spawns a worktree, drafts a senior-engineer-grade spec.md via spec-kit, hands off to Coder.',
        designation: 'Software Architect',
        role_id: 'architect',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 3,
        concurrent_runs: 1,
        glyph: 'architecture',
        prompt_md: ARCHITECT_PROMPT,
        handoff_prompt_md:
            'When you finish: the paired Architect reviewer agent (`agent-architect-reviewer`) fetches the spec from origin/<branch> and walks the checklist. On pass, the chain advances to **Coder**, who reuses the same worktree to run the rest of the spec-kit lifecycle and raise the PR. Never remove the worktree — Coder needs it.',
        push_code: true,
        requires_worktree: true,
    },
    // Tester removed in P1 — `agent-tester` is deleted by migration 030.
    // Automation Engineer post-merge automation-tests flow. Picks up a
    // QA Story whose dev Coder PR has merged, runs on the harness-
    // provisioned worktree on the QA Story's `worktree_branch` (the
    // same branch QA Writer authored the test-plan CSV on), writes a
    // test file per `automation-yes` CSV row, runs the project test
    // suite locally, commits, and transitions the QA Story to
    // `in_review`. The orchestrator pushes the branch and the paired
    // reviewer agent's clean exit opens the PR against `main`.
    {
        id: 'agent-automation',
        name: 'Automation Engineer',
        category: 'software-dev',
        cli: 'copilot',
        // Workstream #4 — Copilot CLI registry uses the dot form;
        // `cli_models` row is `claude-sonnet-4.6`. The hyphen form is
        // the Claude-CLI strain and never matched the copilot registry.
        model: 'claude-sonnet-4.6',
        framework: 'test-automation',
        prompt_version: 1,
        status: 'active',
        accent_color: '#0F9D58',
        sort_order: 5,
        description: 'Test-automation engineer. Picks up a QA Story whose dev Coder PR has merged, runs on the harness-provisioned worktree on the QA Story\'s `worktree_branch`, writes a test file per `automation-yes` row in `tests/qa/<storyId>.csv`, runs the project test suite locally, commits, and transitions the QA Story to `in_review`. The orchestrator pushes; the Automation Reviewer\'s clean exit opens the PR against `main`.',
        designation: 'Automation Engineer',
        role_id: 'automation',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 2,
        concurrent_runs: 1,
        glyph: 'precision_manufacturing',
        prompt_md: AUTOMATION_PROMPT,
        handoff_prompt_md:
            'When you finish: the paired Automation reviewer agent (`agent-automation-reviewer`) walks the PR diff for `[automation_candidate]` coverage and runs the project\'s test suite on the PR head. On pass, the chain terminally returns the QA Story to the Owner with status `in_review`. On fail, the reviewer agent bounces back to you with the failing coverage gap inline (up to `max_rounds` retries).',
        push_code: true,
        requires_worktree: true,
    },
    // ── T1 — Dedicated reviewer agents (one per SDLC role) ────────────
    // Each reviewer is a standalone agent whose `prompt_md` is the
    // reviewer-side prompt (formerly bundled on the performer row as
    // formerly the bundled reviewer-prompt column). On-pass handoff fires the standard
    // inter-agent dispatch path: performer.on-pass → reviewer; reviewer
    // grades; reviewer.on-pass → next role's performer (or Owner if
    // terminal); reviewer.on-fail → paired performer (retry round).
    {
        id: 'agent-po-reviewer',
        name: 'PO Reviewer',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: 'review',
        prompt_version: 1,
        status: 'active',
        accent_color: '#0E5C99',
        sort_order: 12,
        description:
            'Dedicated reviewer paired with `agent-po-writer`. Grades the dev story / QA twin breakdown against the PO Writer checklist, then routes via `submit_review` (pass → Architect + QA Writer fan-out, fail → PO Writer retry, needs_info → Owner).',
        designation: 'Product Owner — Reviewer',
        role_id: 'po',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 3,
        concurrent_runs: 1,
        glyph: 'fact_check',
        prompt_md: PO_REVIEWER_PROMPT,
        handoff_prompt_md: '',
        requires_worktree: true,
    },
    {
        id: 'agent-architect-reviewer',
        name: 'Architect Reviewer',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: 'review',
        prompt_version: 1,
        status: 'active',
        accent_color: '#4263CB',
        sort_order: 13,
        description:
            'Dedicated reviewer paired with `agent-architect`. Fetches the spec from origin/<branch>, walks every required section, and routes via `submit_review` (pass → Coder, fail → Architect retry, needs_info → Owner).',
        designation: 'Software Architect — Reviewer',
        role_id: 'architect',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 3,
        concurrent_runs: 1,
        glyph: 'fact_check',
        prompt_md: ARCHITECT_REVIEWER_PROMPT,
        handoff_prompt_md: '',
        requires_worktree: true,
    },
    {
        id: 'agent-code-reviewer',
        name: 'Code Reviewer',
        category: 'software-dev',
        cli: 'copilot',
        // Workstream #4 — Copilot CLI registry uses the dot form;
        // `cli_models` row is `claude-sonnet-4.6`. The hyphen form is
        // the Claude-CLI strain and never matched the copilot registry.
        model: 'claude-sonnet-4.6',
        framework: 'review',
        prompt_version: 1,
        status: 'active',
        accent_color: '#1D8348',
        sort_order: 14,
        description:
            'Dedicated reviewer paired with `agent-coder`. Confirms PR diff covers every spec.md change, scans for anti-patterns, clones the PR head and runs `pnpm test`. Routes via `submit_review` (pass → QA Writer, fail → Coder retry, needs_info → Owner).',
        designation: 'Code — Reviewer',
        role_id: 'engineer',
        max_rounds: 5,
        requires_item: true,
        schedule_preset: 'every_n_hours',
        schedule_hours: 1,
        cron_expr: null,
        concurrent_runs: 1,
        glyph: 'fact_check',
        prompt_md: CODE_REVIEWER_PROMPT,
        handoff_prompt_md: '',
        raises_pr: true,
        push_code: true,
        requires_worktree: true,
    },
    {
        id: 'agent-qa-reviewer',
        name: 'QA Reviewer',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-sonnet-4-6',
        framework: 'review',
        prompt_version: 1,
        status: 'active',
        accent_color: '#8E44AD',
        sort_order: 15,
        description:
            'Dedicated reviewer paired with `agent-qa-writer`. Counts sub-tasks per (criterion × applicable kind), enforces the five-kind coverage floor, and verifies the `tested_by` link. Routes via `submit_review` (pass → Owner, fail → QA Writer retry, needs_info → Owner).',
        designation: 'Quality Assurance — Reviewer',
        role_id: 'qa',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 2,
        concurrent_runs: 1,
        glyph: 'fact_check',
        prompt_md: QA_REVIEWER_PROMPT,
        handoff_prompt_md: '',
        raises_pr: true,
        push_code: true,
        requires_worktree: true,
    },
    {
        id: 'agent-automation-reviewer',
        name: 'Automation Reviewer',
        category: 'software-dev',
        cli: 'copilot',
        // Workstream #4 — Copilot CLI registry uses the dot form;
        // `cli_models` row is `claude-sonnet-4.6`. The hyphen form is
        // the Claude-CLI strain and never matched the copilot registry.
        model: 'claude-sonnet-4.6',
        framework: 'review',
        prompt_version: 1,
        status: 'active',
        accent_color: '#0B7A4B',
        sort_order: 16,
        description:
            'Dedicated reviewer paired with `agent-automation`. Confirms the PR head matches the QA Story\'s `worktree_branch` and targets `main`, walks the diff for `automation-yes` coverage from the QA test-plan CSV + `not automated:` roll-up comments for `automation-no` rows, scans new tests for anti-patterns (sleeps, brittle selectors, dangling promises), and runs the project test suite on the PR head. Routes via `submit_review` (pass → Owner with status `in_review`, fail → Automation retry, needs_info → Owner).',
        designation: 'Automation Engineer — Reviewer',
        role_id: 'automation',
        max_rounds: 5,
        requires_item: true,
        schedule_hours: 2,
        concurrent_runs: 1,
        glyph: 'fact_check',
        prompt_md: AUTOMATION_REVIEWER_PROMPT,
        handoff_prompt_md: '',
        raises_pr: true,
        push_code: true,
        requires_worktree: true,
    },
    // DevOps / Security Reviewer / Designer removed in P1 —
    // `agent-devops`, `agent-security-reviewer`, and `agent-designer`
    // are deleted by migration 030.
    // ── Theme 09 — autonomous agent fleet (4 inactive seeds) ──────────
    // Each is a freedom agent (requires_item=false) so the scheduler
    // dispatches on schedule_hours / cron_expr without needing a
    // queued item. All ship `status: 'inactive'` so the Owner
    // configures `settings_json` before flipping them on.
    {
        id: 'agent-ai-news',
        name: 'AI News Scout',
        category: 'content',
        cli: 'claude',
        // Utility agents use the `haiku` model from the cli_models registry
        // (cheaper / faster for scraping + digest tasks where deep reasoning
        // is not the bottleneck). Migration 040 reconciles existing rows.
        model: 'haiku',
        framework: 'scout',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#FACC15',
        sort_order: 8,
        description: 'Daily 24-hour AI-tooling digest delivered as an external notification at 09:00 Owner-local. Scrapes via Playwright MCP. Edit the prompt with your curated sources, then activate.',
        designation: 'Daily AI News Scout',
        max_rounds: 5,
        requires_item: false,
        schedule_preset: 'daily',
        schedule_time_of_day: '09:00',
        concurrent_runs: 1,
        glyph: 'newspaper',
        prompt_md: loadPrompt('ai-news-daily.md'),
        handoff_prompt_md: '',
        kind_slug: 'ai-news',
        settings_json: {},
        cron_expr: null,
    },
    {
        id: 'agent-market-research',
        name: 'Market Research',
        category: 'content',
        cli: 'claude',
        model: 'haiku',
        framework: 'competitive-watch',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#84CC16',
        sort_order: 9,
        description: 'Weekly competitor pricing + positioning watch. Edit the prompt with your Atlas project name + competitor list, then activate.',
        designation: 'Competitive Analyst',
        max_rounds: 5,
        requires_item: false,
        schedule_hours: 168,
        concurrent_runs: 1,
        glyph: 'monitoring',
        prompt_md: loadPrompt('market-research.md'),
        handoff_prompt_md: '',
        kind_slug: 'market-research',
        settings_json: {},
        cron_expr: null,
    },
    {
        id: 'agent-regulations',
        name: 'Regulations Scout',
        category: 'content',
        cli: 'claude',
        model: 'haiku',
        framework: 'compliance-watch',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#0EA5E9',
        sort_order: 10,
        description: 'Weekly regulator-news scan scoped to your project_type + regions. Edit the prompt with your Atlas project name + project type + regions, then activate.',
        designation: 'Legal Scout',
        max_rounds: 5,
        requires_item: false,
        schedule_hours: 168,
        concurrent_runs: 1,
        glyph: 'gavel',
        prompt_md: loadPrompt('regulations.md'),
        handoff_prompt_md: '',
        kind_slug: 'regulations',
        settings_json: {},
        cron_expr: null,
    },
    {
        id: 'agent-jira-to-epic',
        name: 'Jira Importer',
        category: 'software-dev',
        cli: 'claude',
        model: 'haiku',
        framework: 'importer',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#3B82F6',
        sort_order: 6,
        description: 'Daily at 09:00, pulls your Jira-assigned items into Atlas as draft epics. Edit the prompt with your Atlas project name, then activate.',
        designation: 'Jira Importer',
        max_rounds: 5,
        requires_item: false,
        // P1 — Jira importer moves from every-4-hours to daily at 09:00
        // local. Migration 030 reconciles existing rows.
        schedule_preset: 'daily',
        schedule_time_of_day: '09:00',
        concurrent_runs: 1,
        glyph: 'sync_alt',
        prompt_md: loadPrompt('jira-to-epic.md'),
        handoff_prompt_md: '',
        kind_slug: 'jira-to-epic',
        settings_json: {},
        cron_expr: null,
    },
    // ── Theme 09b — AI-Readiness Agent ────────────────────────────────
    // Manually triggered from Project Detail. Two responsibilities:
    //   1. Read the project end-to-end and write a layered `.agents/`
    //      scaffold (always-on + conditional docs) on a fresh branch,
    //      then open a PR via `gh`.
    //   2. Bootstrap GitHub Spec Kit on the host (detect-then-install
    //      `uv` + `specify-cli`) so the downstream SDLC chain
    //      (Architect → Coder) finds `specify` on PATH.
    //
    // Sits on `claude-opus-4-7[1m]` (1M context) after migration 045 —
    // it's a one-time-per-project job that ingests the whole repo in
    // one sweep, so the larger window matters even though every other
    // SDLC agent dropped Opus.
    {
        id: 'agent-ai-readiness',
        name: 'AI Readiness Specialist',
        category: 'software-dev',
        cli: 'claude',
        model: 'claude-opus-4-7[1m]',
        framework: 'scaffolding',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#6366F1',
        sort_order: 7,
        description: 'Walks the repo end-to-end (every package, public surfaces, key code paths, observed conventions) regardless of stack, then bootstraps an AI-ready scaffold on a fresh branch — 8 always-on docs (AGENTS.md, CLAUDE.md, Copilot instructions, .agents/README.md + architecture.md + conventions.md + glossary.md + memory.md) plus up to 4 conditional .agents/ docs (data-model.md, api-surface.md, routes-map.md, testing.md) gated on what is detected. Also installs GitHub Spec Kit (uv + specify-cli) on the host so the downstream SDLC chain (Architect → Coder → QA → Curator) lands on a ready environment. memory.md is a bootstrap digest future agent runs read first. Fires from the "Generate AI scaffold" button on Project Detail.',
        designation: 'AI Readiness Specialist',
        max_rounds: 5,
        requires_item: false,
        schedule_hours: 0,
        concurrent_runs: 1,
        glyph: 'rocket_launch',
        prompt_md: loadPrompt('ai-readiness.md'),
        handoff_prompt_md: '',
        kind_slug: 'ai-readiness',
        settings_json: {},
        cron_expr: null,
        push_code: true,
        requires_worktree: true,
        raises_pr: true,
    },
    // C08 — Knowledge Base Curator. Per-project `skills/` folder maintenance:
    // Owner triggers a run, agent surveys the target project's codebase,
    // identifies 1-3 documentation gaps, writes / refines `skills/<topic>.md`
    // entries on a fresh `atlas/skills-<YYYY-MM-DD>` branch, opens a PR via
    // `gh`. Manual / on-demand only (no schedule). Project_id is supplied via
    // the Run-now dispatch path same as `agent-ai-readiness`.
    {
        id: 'agent-knowledge-base',
        name: 'Knowledge Base Curator',
        category: 'content',
        cli: 'claude',
        model: 'haiku',
        framework: 'docs',
        prompt_version: 1,
        status: 'inactive',
        accent_color: '#7C3AED',
        sort_order: 11,
        description: 'Curates a `skills/` folder under each Atlas-managed project — Confluence-style technical reference of the application. Owner triggers a run, agent picks 1-3 documentation gaps, opens a PR with new / refined `skills/<topic>.md` entries.',
        designation: 'Knowledge Base Curator',
        max_rounds: 5,
        requires_item: false,
        schedule_hours: 0,
        concurrent_runs: 1,
        glyph: 'menu_book',
        prompt_md: loadPrompt('knowledge-base.md'),
        handoff_prompt_md: '',
        kind_slug: 'knowledge-base',
        settings_json: {},
        cron_expr: null,
        push_code: true,
        raises_pr: true,
        requires_worktree: true,
    },
];

// 2026-05-31 — Handoff rules realigned: handoffs are ONLY the agent's
// terminal "I'm done" routing. Two rows per SDLC agent (on-pass +
// on-fail), uniform shape. Intermediate routing — PO Reviewer
// dispatching dev/QA children to Architect/QA Writer, any reviewer
// sending a story back to its paired performer for revision — lives in
// the prompt, where the agent uses Atlas MCP (`assignItem`,
// `transitionItemStatus`, `addCommentToItem`) directly. The runner
// detects mid-run reassignment and silently skips the on-pass rule
// when the agent already routed the item itself.
//
// Two patterns, every SDLC agent fits one:
//   Performer: on-pass → paired reviewer / `ready`
//              on-fail → owner / `waiting_for_info`
//   Reviewer:  on-pass → next-phase agent (`ready`) OR owner
//              (`in_review` for terminal reviewers — PO/Engineer/QA/
//              Automation Reviewer end with Owner-in-review)
//              on-fail → owner / `waiting_for_info`
//
// Terminal reviewers route to Owner with `in_review` (work product is
// ready for Owner to inspect / merge). Mid-chain reviewers route to
// the next performer with `ready` so it can be picked up immediately.
// on-fail uniformly escalates to Owner — never bounces back to the
// performer (that's the prompt-driven revision loop, not a handoff).
export const HANDOFF_RULE_SEEDS: HandoffRuleSeed[] = [
    // ── Performers: on-pass → paired reviewer (ready) ───────────────
    { agent_id: 'agent-po-writer', target_agent_id: 'agent-po-reviewer', kind: 'on-pass', status: 'ready' },
    { agent_id: 'agent-architect', target_agent_id: 'agent-architect-reviewer', kind: 'on-pass', status: 'ready' },
    { agent_id: 'agent-coder', target_agent_id: 'agent-code-reviewer', kind: 'on-pass', status: 'ready' },
    { agent_id: 'agent-qa-writer', target_agent_id: 'agent-qa-reviewer', kind: 'on-pass', status: 'ready' },
    { agent_id: 'agent-automation', target_agent_id: 'agent-automation-reviewer', kind: 'on-pass', status: 'ready' },

    // ── Reviewers: on-pass ──────────────────────────────────────────
    // Architect Reviewer hands the dev story onward to Coder. Every
    // other reviewer's work product reaches Owner in `in_review` —
    // PO Reviewer hands the epic to Owner (dev/QA children are
    // already in flight from the prompt's MCP dispatch); Engineer
    // Reviewer hands the merged-PR story to Owner; QA Reviewer hands
    // the verified QA story to Owner; Automation Reviewer hands the
    // PR-raised automation story to Owner.
    { agent_id: 'agent-po-reviewer', target_agent_id: 'owner', kind: 'on-pass', status: 'in_review' },
    { agent_id: 'agent-architect-reviewer', target_agent_id: 'agent-coder', kind: 'on-pass', status: 'ready' },
    { agent_id: 'agent-code-reviewer', target_agent_id: 'owner', kind: 'on-pass', status: 'in_review' },
    { agent_id: 'agent-qa-reviewer', target_agent_id: 'owner', kind: 'on-pass', status: 'in_review' },
    { agent_id: 'agent-automation-reviewer', target_agent_id: 'owner', kind: 'on-pass', status: 'in_review' },

    // ── Every SDLC agent: on-fail → Owner (waiting_for_info) ────────
    // Uniform escalation. on-fail means "I'm blocked / I have a
    // question Owner must answer". The reviewer-needs-revision loop
    // is NOT on-fail — it's handled in the prompt via MCP.
    { agent_id: 'agent-po-writer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-po-reviewer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-architect', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-architect-reviewer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-coder', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-code-reviewer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-qa-writer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-qa-reviewer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-automation', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-automation-reviewer', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    // 2026-05-30 — Self-contained agents (Jira Importer, AI Readiness
    // Specialist, AI News Scout, Market Research, Regulations Scout,
    // Knowledge Base Curator). These don't pass work to a downstream
    // SDLC role — both on-pass and on-fail route back to the Owner.
    // `target_agent_id = 'owner'` is the sentinel the resolver
    // (`agent-handoff.ts`) translates to "Owner queue" (assigneeId =
    // null). Migration 042 backfills these rows on existing live DBs;
    // `runSeed()` only inserts handoff rules for agents that are newly
    // added to the seed.
    { agent_id: 'agent-jira-to-epic', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-jira-to-epic', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-ai-readiness', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-ai-readiness', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-ai-news', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-ai-news', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-market-research', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-market-research', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-regulations', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-regulations', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    { agent_id: 'agent-knowledge-base', target_agent_id: 'owner', kind: 'on-pass', status: 'done' },
    { agent_id: 'agent-knowledge-base', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
];

export const CHECKLIST_SEEDS: ChecklistSeed[] = [
    // PO Writer
    { agent_id: 'agent-po-writer', label: 'Every story follows As-a / I-want / so-that', sort_order: 0, required: true },
    { agent_id: 'agent-po-writer', label: 'Every story is an end-to-end functional slice (no FE-only / BE-only halves)', sort_order: 1, required: true },
    { agent_id: 'agent-po-writer', label: 'Stories are independently shippable (no cross-story sequencing)', sort_order: 2, required: true },
    { agent_id: 'agent-po-writer', label: 'Total dev-story count is between 1 and 8', sort_order: 3, required: true },
    { agent_id: 'agent-po-writer', label: 'No implementation detail leaked into any story', sort_order: 4, required: true },
    { agent_id: 'agent-po-writer', label: 'Every story has at least three Given / When / Then acceptance criteria bullets', sort_order: 5, required: true },
    { agent_id: 'agent-po-writer', label: 'Every dev story has a [QA] twin linked via `tested_by`', sort_order: 6, required: true },
    // Spec Writer checklist removed in P1 — `agent-spec-writer` is
    // deleted by migration 030.
    // Coder
    { agent_id: 'agent-coder', label: 'pnpm typecheck clean across affected packages', sort_order: 0, required: true },
    { agent_id: 'agent-coder', label: 'At least one new unit test added; integration test added if surface dictates', sort_order: 1, required: true },
    { agent_id: 'agent-coder', label: 'pnpm test clean across affected packages', sort_order: 2, required: true },
    { agent_id: 'agent-coder', label: 'Commit message follows Conventional Commits', sort_order: 3, required: true },
    { agent_id: 'agent-coder', label: 'No console.log / debugger / TODO residue in the diff', sort_order: 4, required: true },
    // QA Writer
    { agent_id: 'agent-qa-writer', label: 'Happy-path scenario exists and passes', sort_order: 0, required: true },
    { agent_id: 'agent-qa-writer', label: 'At least 2 edge-case scenarios exist and pass', sort_order: 1, required: true },
    { agent_id: 'agent-qa-writer', label: 'Scenarios use stable selectors (no nth-child / brittle CSS)', sort_order: 2, required: true },
    { agent_id: 'agent-qa-writer', label: 'No explicit sleeps — only awaitable waits', sort_order: 3, required: true },
];

// Two-phase seeding:
//   1. Sync the on-disk catalog (packages/api/src/marketplace/catalog/) into
//      the marketplace_agents table. Idempotent — content_hash drives whether
//      version bumps. Existing local agents are NEVER mutated here, even on
//      catalog upgrade; the UI surfaces the diff and the Owner accepts.
//   2. Auto-install (fork) catalog entries into agents for ids that don't
//      already exist locally. Sets marketplace_source_id +
//      marketplace_pulled_version on the new local row so the back-link is
//      ready from day one.
//
// Owner edits on a local agent never break the back-link — they simply mean
// the local row diverges from the catalog. Detach (UI action) is the only
// way to clear the link.
async function syncMarketplaceCatalog(): Promise<CatalogEntry[]> {
    const catalog = loadCatalog();
    if (catalog.length === 0) return [];

    const existing = await db
        .selectFrom('marketplace_agents')
        .select(['id', 'content_hash', 'version'])
        .execute();
    const existingById = new Map(existing.map((r) => [r.id, r]));

    await db.transaction().execute(async (trx) => {
        for (const entry of catalog) {
            const prior = existingById.get(entry.manifest.id);
            // Versioning is manifest-controlled: the catalog version always
            // equals the value the author declared in manifest.json. Bumping a
            // version is now an explicit edit (e.g. 1 -> 2) made alongside the
            // content change you want to publish - not a side effect of any
            // byte changing in the bundle. This kills the "upgrade available
            // but nothing to apply" banner that the old content_hash auto-bump
            // produced for metadata-only / memory.md edits (the bump surface
            // was wider than the 5 fields the upgrade modal can apply).
            // content_hash is still computed and stored below for future
            // change-detection use; it just no longer drives the version.
            const nextVersion = entry.manifest.version;
            const row = {
                id: entry.manifest.id,
                name: entry.manifest.name,
                category: entry.manifest.category,
                cli: entry.manifest.cli,
                model: entry.manifest.model,
                framework: entry.manifest.framework,
                prompt_md: entry.prompt_md,
                handoff_prompt_md: entry.manifest.handoff_prompt_md,
                description: entry.manifest.description,
                designation: entry.manifest.designation,
                accent_color: entry.manifest.accent_color,
                sort_order: entry.manifest.sort_order,
                glyph: entry.manifest.glyph,
                role_id: entry.manifest.role_id,
                max_rounds: entry.manifest.max_rounds,
                requires_item: entry.manifest.requires_item,
                requires_worktree: entry.manifest.requires_worktree,
                push_code: entry.manifest.push_code,
                raises_pr: entry.manifest.raises_pr,
                status: entry.manifest.status,
                kind_slug: entry.manifest.kind_slug,
                settings_json: entry.manifest.settings_json,
                schedule_hours: entry.manifest.schedule_hours,
                schedule_preset: entry.manifest.schedule_preset,
                schedule_time_of_day: entry.manifest.schedule_time_of_day,
                schedule_weekdays: entry.manifest.schedule_weekdays,
                schedule_day_of_month: entry.manifest.schedule_day_of_month,
                cron_expr: entry.manifest.cron_expr,
                concurrent_runs: entry.manifest.concurrent_runs,
                memory_cadence: entry.manifest.memory_cadence,
                memory_template_md: entry.memory_md,
                summary: entry.manifest.summary,
                version: nextVersion,
                content_hash: entry.content_hash,
                published_at: entry.manifest.published_at,
                updated_at: new Date().toISOString(),
            };

            if (prior == null) {
                await trx.insertInto('marketplace_agents').values(row).execute();
            } else {
                await trx.updateTable('marketplace_agents').set(row).where('id', '=', row.id).execute();
                await trx
                    .deleteFrom('marketplace_agent_handoffs')
                    .where('marketplace_agent_id', '=', row.id)
                    .execute();
                await trx
                    .deleteFrom('marketplace_agent_checklists')
                    .where('marketplace_agent_id', '=', row.id)
                    .execute();
            }

            if (entry.handoff_rules.length > 0) {
                await trx
                    .insertInto('marketplace_agent_handoffs')
                    .values(
                        entry.handoff_rules.map((h) => ({
                            marketplace_agent_id: row.id,
                            target_agent_id: h.target_agent_id,
                            kind: h.kind,
                            status: h.status,
                        }))
                    )
                    .execute();
            }
            if (entry.checklists.length > 0) {
                await trx
                    .insertInto('marketplace_agent_checklists')
                    .values(
                        entry.checklists.map((c) => ({
                            marketplace_agent_id: row.id,
                            label: c.label,
                            sort_order: c.sort_order,
                            required: c.required,
                        }))
                    )
                    .execute();
            }
        }
    });

    return catalog;
}

// Phase 2 of the /commands framework redesign — five artifact templates
// (`spec`, `plan`, `tasks`, `story`, `qa-plan`) seeded into the
// `agent_templates` table. The templates-assembler writes each row to
// `<worktree>/.atlas/templates/<filename>` per run so the slash-command
// bodies can reference a stable shape. Owner edits via direct DB writes
// for now; the planned Settings tab follows in a separate plan.
//
// Bodies are kept short — section headers + one-line placeholders. The
// agent fills them in; the template just enforces shape.

interface AgentTemplateSeed {
    id: string;
    filename: string;
    description: string;
    body_md: string;
}

const SPEC_TEMPLATE_MD = `# Spec

> Architect-grade spec for this story. Every section below MUST have
> substantive content before review — empty sections fail.

## Feasibility

<Is the change feasible against the project's current architecture? Quote the constraint that makes it so, or call out the blocker.>

## Tech stack

<Which packages / layers does this touch? Which language / framework choices are forced by existing code?>

## Libraries to install

<Explicit list with package names + rationale. \`(none)\` is a valid answer; silence is not.>

## File-level change list

<For every file Coder will create, edit, or delete, one line: \`<path>\` — \`<what changes>\`.>

## Test scenarios

<Given / When / Then bullets, one per acceptance criterion, mapped to the story's existing acceptance criteria.>

## Performance + security notes

<Hot paths, query patterns, auth boundaries, secret handling. \`(no concerns)\` is a valid answer.>
`;

const PLAN_TEMPLATE_MD = `# Implementation plan

> Coder's per-step execution plan. One commit per step; verify between
> steps; never advance while a verifier is red.

## Step 1 — <short title>

- **Files**: \`<path/to/file.ts>\`, \`<path/to/other.ts>\`
- **What changes**: <one-paragraph description of the diff>
- **Verify**: \`<command — e.g. \`pnpm --filter @atlas/api typecheck\`>\`
- **Commit**: \`<conventional-commit subject — e.g. \`feat(api): <one-liner>\`>\`

## Step 2 — <short title>

- **Files**: \`<path>\`
- **What changes**: <description>
- **Verify**: \`<command>\`
- **Commit**: \`<subject>\`

## Step N — <short title>

- **Files**: \`<path>\`
- **What changes**: <description>
- **Verify**: \`<command>\`
- **Commit**: \`<subject>\`

## Final verification

- \`pnpm typecheck\` — green across affected packages
- \`pnpm lint\` — green across affected packages
- New + modified tests cover every entry in spec.md's File-level change list
`;

const TASKS_TEMPLATE_MD = `# Tasks

> One bullet per file Coder touches. Each carries the file path + the
> verification command that proves the task is done. Mirrors spec.md's
> File-level change list — every entry there gets a task here.

- [ ] \`<path/to/file.ts>\` — <what changes>
  - Verify: \`<command — e.g. \`pnpm --filter @atlas/api exec tsc --noEmit\`>\`

- [ ] \`<path/to/other.ts>\` — <what changes>
  - Verify: \`<command>\`

- [ ] \`<path/to/test.test.ts>\` — <new / updated tests>
  - Verify: \`pnpm --filter @atlas/api test <test-file>\`
`;

const STORY_TEMPLATE_MD = `# Story

## User story

As a **<user role>**, I want **<outcome>**, so that **<reason>**.

<One-paragraph capability narrative describing the user-visible behaviour end to end.>

## Acceptance criteria

- **Given** <precondition>, **when** <action>, **then** <observable outcome>.
- **Given** <precondition>, **when** <action>, **then** <observable outcome>.
- **Given** <precondition>, **when** <action>, **then** <observable outcome>.

> Three bullets minimum (happy path + two edge cases). Downstream agents
> use these lines as the test contract.
`;

const QA_PLAN_TEMPLATE_CSV = `test-id,criterion-id,kind,automation-yes-no,scenario,expected
# Example (delete before commit): T01,AC1,functional,automation-yes,User signs in with valid creds,Dashboard loads within 2s
`;

const AGENT_TEMPLATE_SEEDS: AgentTemplateSeed[] = [
    {
        id: 'spec',
        filename: 'spec.md',
        description: "Architect's spec template (6 required sections)",
        body_md: SPEC_TEMPLATE_MD,
    },
    {
        id: 'plan',
        filename: 'plan.md',
        description: "Coder's implementation plan template",
        body_md: PLAN_TEMPLATE_MD,
    },
    {
        id: 'tasks',
        filename: 'tasks.md',
        description: "Coder's per-file task breakdown",
        body_md: TASKS_TEMPLATE_MD,
    },
    {
        id: 'story',
        filename: 'story.md',
        description: 'PO Writer story template',
        body_md: STORY_TEMPLATE_MD,
    },
    {
        id: 'qa-plan',
        filename: 'qa-plan.csv',
        description: 'QA Writer test plan CSV schema',
        body_md: QA_PLAN_TEMPLATE_CSV,
    },
];

// ─── Phase 3 — Per-agent SDLC validation scripts ─────────────────────
//
// The `guardrail_scripts` table already has a write-to-worktree
// pipeline via `constitution-assembler.ts:81-91`. The 10 rows seeded
// by migration 079 are CROSS-CUTTING checks (no-delete guard,
// secrets-in-diff, etc.) keyed by random UUID. The 6 named rows below
// are PER-AGENT validators each per-agent slash-command body invokes
// before declaring `outcome: done`. Each script takes the item id as
// `$1` (or `$args[0]` on PowerShell), exits 0 on green, or exits 1
// with a numbered gap list to stdout.
//
// Idempotency: ON CONFLICT (id) DO UPDATE. Edits to these bodies in
// future commits propagate to existing dbs on next `runSeed()`.
//
// PowerShell encoding: ASCII-only per memory
// `feedback_powershell_scripts_must_be_ascii` (PS 5.1 reads non-BOM
// UTF-8 as ANSI and parser-errors on non-ASCII). No em dashes, curly
// quotes, or arrow glyphs in any `.ps1` body.

interface GuardrailScriptSeed {
    id: string;
    name: string;
    description: string;
    sort_order: number;
    body_sh: string;
    body_ps1: string;
}

export const GUARDRAIL_SCRIPT_SEEDS: GuardrailScriptSeed[] = [
    {
        id: 'prereqs',
        name: 'Worktree prereqs',
        description:
            'Gates every agent run. Verifies the worktree is clean, the .atlas directory is staged, and the constitution lives on disk before the agent emits work.',
        sort_order: 100,
        body_sh: `#!/usr/bin/env bash
# Worktree prereqs gate. $1 is the item id (ignored here).
set -u
gaps=""
n=0
dirty="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$dirty" ]; then
    n=$((n+1))
    gaps="$gaps$n. dirty working tree
"
fi
if [ ! -d .atlas ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas directory missing
"
fi
if [ ! -f .atlas/constitution.md ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas/constitution.md missing
"
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "prereqs:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Worktree prereqs gate. $args[0] is the item id (ignored here).
$ErrorActionPreference = 'Continue'
$gaps = New-Object System.Collections.ArrayList
$dirty = git status --porcelain 2>$null
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    [void]$gaps.Add('dirty working tree')
}
if (-not (Test-Path -LiteralPath '.atlas' -PathType Container)) {
    [void]$gaps.Add('.atlas directory missing')
}
if (-not (Test-Path -LiteralPath '.atlas/constitution.md' -PathType Leaf)) {
    [void]$gaps.Add('.atlas/constitution.md missing')
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'prereqs:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'po-writer-output',
        name: 'PO Writer output check',
        description:
            'Verifies the PO Writer staged a current-task snapshot for the epic. Phase 3.5 will deepen this once MCP CLI bindings exist (needs cross-checks for [QA] twins and tested_by links).',
        sort_order: 101,
        body_sh: `#!/usr/bin/env bash
# PO Writer output gate. $1 is the epic id.
# Phase 3.5 will deepen this once MCP CLI bindings exist.
# For now, verify .atlas/current-task.md was written and is non-empty.
set -u
gaps=""
n=0
if [ ! -f .atlas/current-task.md ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas/current-task.md missing
"
elif [ ! -s .atlas/current-task.md ]; then
    n=$((n+1))
    gaps="$gaps$n. .atlas/current-task.md is empty
"
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "po-writer-output:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# PO Writer output gate. $args[0] is the epic id.
# Phase 3.5 will deepen this once MCP CLI bindings exist.
$ErrorActionPreference = 'Continue'
$gaps = New-Object System.Collections.ArrayList
$path = '.atlas/current-task.md'
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    [void]$gaps.Add('.atlas/current-task.md missing')
} elseif ((Get-Item -LiteralPath $path).Length -eq 0) {
    [void]$gaps.Add('.atlas/current-task.md is empty')
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'po-writer-output:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'architect-spec-md',
        name: 'Architect spec.md sections',
        description:
            'Verifies the architect emitted a spec.md under specs/ that carries all six required section headers.',
        sort_order: 102,
        body_sh: `#!/usr/bin/env bash
# Architect spec.md section gate. $1 is the item id (unused; located by find).
# Locates any specs/**/spec.md and verifies the six required section headers.
# Freshness vs .atlas/current-task.md is NOT checked: the harness rewrites
# current-task.md when provisioning each agent's worktree (after a Path-1
# git pull touches spec.md), which produced a deterministic race that failed
# the reviewer on a perfectly-valid spec. Existence + section coverage is
# the real gate; freshness was a brittle proxy.
set -u
gaps=""
n=0
spec=""
if [ -d specs ]; then
    spec="$(find specs -name spec.md 2>/dev/null | head -1)"
fi
if [ -z "$spec" ] || [ ! -f "$spec" ]; then
    n=$((n+1))
    gaps="$gaps$n. no specs/**/spec.md found
"
    printf "architect-spec-md:\\n%s" "$gaps"
    exit 1
fi
required="## Feasibility|## Tech stack|## Libraries to install|## File-level change list|## Test scenarios|## Performance + security"
IFS='|'
for header in $required; do
    if ! grep -qF "$header" "$spec"; then
        n=$((n+1))
        gaps="$gaps$n. spec.md missing section: $header
"
    fi
done
unset IFS
if [ -z "$gaps" ]; then exit 0; fi
printf "architect-spec-md (%s):\\n%s" "$spec" "$gaps"
exit 1
`,
        body_ps1: `# Architect spec.md section gate. $args[0] is the item id (unused).
# Locates any specs/**/spec.md and verifies the six required section headers.
# Freshness vs .atlas/current-task.md is NOT checked (see body_sh for why).
$ErrorActionPreference = 'Continue'
$spec = $null
if (Test-Path -LiteralPath 'specs' -PathType Container) {
    $candidates = Get-ChildItem -Path 'specs' -Filter 'spec.md' -Recurse -File -ErrorAction SilentlyContinue
    if ($candidates -and $candidates.Count -gt 0) { $spec = $candidates[0].FullName }
}
if ($spec -eq $null) {
    Write-Output 'architect-spec-md:'
    Write-Output '1. no specs/**/spec.md found'
    exit 1
}
$body = Get-Content -LiteralPath $spec -Raw
$required = @('## Feasibility','## Tech stack','## Libraries to install','## File-level change list','## Test scenarios','## Performance + security')
$gaps = @()
foreach ($h in $required) {
    if (-not $body.Contains($h)) { $gaps += "spec.md missing section: $h" }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("architect-spec-md ({0}):" -f $spec)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'coder-tests-green',
        name: 'Coder typecheck/lint/tests changed',
        description:
            'Coder gate: pnpm typecheck and pnpm lint must exit 0, and the diff against origin/main (or HEAD~10) must add or modify at least one *.test.ts file.',
        sort_order: 103,
        body_sh: `#!/usr/bin/env bash
# Coder gate. $1 is the item id (unused).
set -u
gaps=""
n=0
pnpm typecheck >/dev/null 2>&1
tc=$?
if [ "$tc" -ne 0 ]; then
    n=$((n+1))
    gaps="$gaps$n. typecheck failed
"
fi
pnpm lint >/dev/null 2>&1
lt=$?
if [ "$lt" -ne 0 ]; then
    n=$((n+1))
    gaps="$gaps$n. lint failed
"
fi
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
changed_tests="$(git diff --name-only "$base" HEAD 2>/dev/null | grep -E '\\.test\\.ts$' || true)"
if [ -z "$changed_tests" ]; then
    n=$((n+1))
    gaps="$gaps$n. no test files added/modified
"
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "coder-tests-green:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Coder gate. $args[0] is the item id (unused).
$ErrorActionPreference = 'Continue'
$gaps = New-Object System.Collections.ArrayList
pnpm typecheck 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { [void]$gaps.Add('typecheck failed') }
pnpm lint 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { [void]$gaps.Add('lint failed') }
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$changed = git diff --name-only $base HEAD 2>$null
$tests = @()
if (-not [string]::IsNullOrWhiteSpace($changed)) {
    foreach ($line in ($changed -split "\`r?\`n")) {
        if ($line -match '\\.test\\.ts$') { $tests += $line }
    }
}
if ($tests.Count -eq 0) { [void]$gaps.Add('no test files added/modified') }
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'coder-tests-green:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'qa-writer-csv',
        name: 'QA Writer test-plan CSV',
        description:
            'QA Writer gate: tests/qa/<storyId>.csv must exist, carry the canonical header row, and contain at least one body row.',
        sort_order: 104,
        body_sh: `#!/usr/bin/env bash
# QA Writer gate. $1 is the story id.
set -u
story="\${1:-}"
expected_header="test-id,criterion-id,kind,automation-yes-no,scenario,expected"
gaps=""
n=0
if [ -z "$story" ]; then
    printf "qa-writer-csv:\\n1. story id (\\$1) missing\\n"
    exit 1
fi
csv="tests/qa/\${story}.csv"
if [ ! -f "$csv" ]; then
    printf "qa-writer-csv:\\n1. %s missing\\n" "$csv"
    exit 1
fi
header="$(head -n 1 "$csv" | tr -d '\\r')"
if [ "$header" != "$expected_header" ]; then
    n=$((n+1))
    gaps="$gaps$n. header mismatch (got: $header)
"
fi
row_count="$(($(wc -l < "$csv") - 1))"
if [ "$row_count" -le 0 ]; then
    n=$((n+1))
    gaps="$gaps$n. no test rows
"
fi
# F-006 -- assert HEAD commit touched the CSV. Catches agents that
# claim "I committed N cases" while the CSV is unchanged from a
# prior run. Best-effort; swallow git failures so the primary
# header / row-count gates still surface clearly.
if command -v git >/dev/null 2>&1; then
    head_files="$(git log -1 --name-only --format= HEAD 2>/dev/null | grep -v '^$' || true)"
    if [ -n "$head_files" ] && ! printf "%s\\n" "$head_files" | grep -Fxq "$csv"; then
        n=$((n+1))
        gaps="$gaps$n. HEAD commit does not touch $csv -- did the agent actually commit its change?
"
    fi
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "qa-writer-csv (%s):\\n%s" "$csv" "$gaps"
exit 1
`,
        body_ps1: `# QA Writer gate. $args[0] is the story id.
$ErrorActionPreference = 'Continue'
$story = if ($args.Count -gt 0) { $args[0] } else { '' }
$expected = 'test-id,criterion-id,kind,automation-yes-no,scenario,expected'
$gaps = New-Object System.Collections.ArrayList
if ([string]::IsNullOrWhiteSpace($story)) {
    Write-Output 'qa-writer-csv:'
    Write-Output '1. story id ($args[0]) missing'
    exit 1
}
$csv = "tests/qa/$story.csv"
if (-not (Test-Path -LiteralPath $csv -PathType Leaf)) {
    Write-Output 'qa-writer-csv:'
    Write-Output ("1. {0} missing" -f $csv)
    exit 1
}
$lines = Get-Content -LiteralPath $csv
$header = if ($lines.Count -gt 0) { $lines[0].TrimEnd("\`r") } else { '' }
if ($header -ne $expected) {
    [void]$gaps.Add("header mismatch (got: $header)")
}
$rows = $lines.Count - 1
if ($rows -le 0) { [void]$gaps.Add('no test rows') }
# F-006 -- assert HEAD commit touched the CSV. Catches the case where
# the agent claims "I committed N cases" but the CSV is unchanged
# from a previous run. If the latest commit's name-only output lists
# the CSV path, the current run actually touched it; if not, the
# agent's "what I did" is a hallucination.
try {
    $headFiles = (git log -1 --name-only --format= HEAD 2>$null) -split "\`n" | Where-Object { $_ -match '\\S' }
    if (-not ($headFiles -contains $csv)) {
        [void]$gaps.Add("HEAD commit does not touch $csv -- did the agent actually commit its change?")
    }
} catch {
    # If git itself fails, this gate is best-effort; don't block the
    # primary validators.
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("qa-writer-csv ({0}):" -f $csv)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'check-automation-tests',
        name: 'Automation Engineer test coverage (CSV automation-yes rows)',
        description:
            'Automation Engineer gate: tests/qa/<storyId>.csv must exist; every `automation-yes` row must have its test-id (column 1) appearing in at least one test file added or modified between merge-base and HEAD.',
        sort_order: 105,
        body_sh: `#!/usr/bin/env bash
# Automation Engineer gate. $1 is the story id.
set -u
story="\${1:-}"
gaps=""
n=0
if [ -z "$story" ]; then
    printf "check-automation-tests:\\n1. story id (\\$1) missing\\n"
    exit 1
fi
csv="tests/qa/\${story}.csv"
if [ ! -f "$csv" ]; then
    printf "check-automation-tests:\\n1. %s missing\\n" "$csv"
    exit 1
fi
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
test_files="$(git diff --name-only "$base"..HEAD 2>/dev/null | grep -E '\\.test\\.(ts|tsx|js|jsx)$' || true)"
if [ -z "$test_files" ]; then
    printf "check-automation-tests:\\n1. no .test.{ts,tsx,js,jsx} files added or modified between %s and HEAD\\n" "$base"
    exit 1
fi
# Walk automation-yes rows. CSV columns: test-id,criterion-id,kind,automation-yes-no,scenario,expected
tail -n +2 "$csv" | while IFS=, read -r test_id _criterion _kind automation _rest; do
    if [ "$automation" = "yes" ] && [ -n "$test_id" ]; then
        found=0
        for f in $test_files; do
            [ -f "$f" ] || continue
            if grep -q -- "$test_id" "$f"; then
                found=1
                break
            fi
        done
        if [ "$found" -eq 0 ]; then
            n=$((n+1))
            echo "$n. row $test_id has no matching test in any new/modified test file" >> /tmp/check-auto-gaps.\$\$
        fi
    fi
done
if [ -f /tmp/check-auto-gaps.\$\$ ]; then
    gaps="$(cat /tmp/check-auto-gaps.\$\$)"
    rm -f /tmp/check-auto-gaps.\$\$
fi
if [ -z "$gaps" ]; then exit 0; fi
printf "check-automation-tests (%s):\\n%s\\n" "$csv" "$gaps"
exit 1
`,
        body_ps1: `# Automation Engineer gate. $args[0] is the story id.
$ErrorActionPreference = 'Continue'
$story = if ($args.Count -gt 0) { $args[0] } else { '' }
$gaps = New-Object System.Collections.ArrayList
if ([string]::IsNullOrWhiteSpace($story)) {
    Write-Output 'check-automation-tests:'
    Write-Output '1. story id ($args[0]) missing'
    exit 1
}
$csv = "tests/qa/$story.csv"
if (-not (Test-Path -LiteralPath $csv -PathType Leaf)) {
    Write-Output 'check-automation-tests:'
    Write-Output ("1. {0} missing" -f $csv)
    exit 1
}
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$diffRaw = git diff --name-only "$base..HEAD" 2>$null
$testFiles = @()
if ($diffRaw) {
    $testFiles = ($diffRaw -split "\`r?\`n") | Where-Object { $_ -match '\\.test\\.(ts|tsx|js|jsx)$' -and (Test-Path -LiteralPath $_ -PathType Leaf) }
}
if ($testFiles.Count -eq 0) {
    Write-Output 'check-automation-tests:'
    Write-Output ("1. no .test.{{ts,tsx,js,jsx}} files added or modified between {0} and HEAD" -f $base)
    exit 1
}
# Walk automation-yes rows. CSV columns: test-id,criterion-id,kind,automation-yes-no,scenario,expected
$lines = Get-Content -LiteralPath $csv
for ($i = 1; $i -lt $lines.Count; $i++) {
    $parts = $lines[$i] -split ','
    if ($parts.Count -lt 4) { continue }
    $testId = $parts[0].Trim()
    $automation = $parts[3].Trim()
    if ($automation -ne 'yes' -or [string]::IsNullOrWhiteSpace($testId)) { continue }
    $found = $false
    foreach ($f in $testFiles) {
        try {
            if (Select-String -LiteralPath $f -SimpleMatch -Pattern $testId -Quiet) {
                $found = $true
                break
            }
        } catch { }
    }
    if (-not $found) {
        [void]$gaps.Add("row $testId has no matching test in any new/modified test file")
    }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output ("check-automation-tests ({0}):" -f $csv)
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
    {
        id: 'commit-discipline',
        name: 'Commit discipline (Co-Authored-By trailer)',
        description:
            'Every commit between git merge-base HEAD origin/main and HEAD must carry the Co-Authored-By trailer in its body. Catches commits made without the standard human+AI signature.',
        sort_order: 106,
        body_sh: `#!/usr/bin/env bash
# Commit discipline gate. $1 is the item id (unused).
set -u
base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~10)"
shas="$(git log --format=%H "$base"..HEAD 2>/dev/null || true)"
if [ -z "$shas" ]; then exit 0; fi
gaps=""
n=0
for sha in $shas; do
    body="$(git log -1 --format=%B "$sha" 2>/dev/null || true)"
    if ! printf "%s" "$body" | grep -q "Co-Authored-By:"; then
        n=$((n+1))
        gaps="$gaps$n. commit $sha missing Co-Authored-By trailer
"
    fi
done
if [ -z "$gaps" ]; then exit 0; fi
printf "commit-discipline:\\n%s" "$gaps"
exit 1
`,
        body_ps1: `# Commit discipline gate. $args[0] is the item id (unused).
$ErrorActionPreference = 'Continue'
$base = git merge-base HEAD origin/main 2>$null
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'HEAD~10' }
$shas = git log --format=%H "$base..HEAD" 2>$null
if ([string]::IsNullOrWhiteSpace($shas)) { exit 0 }
$gaps = New-Object System.Collections.ArrayList
foreach ($sha in ($shas -split "\`r?\`n")) {
    if ([string]::IsNullOrWhiteSpace($sha)) { continue }
    $body = git log -1 --format=%B $sha 2>$null
    if (-not ($body -match 'Co-Authored-By:')) {
        [void]$gaps.Add("commit $sha missing Co-Authored-By trailer")
    }
}
if ($gaps.Count -eq 0) { exit 0 }
Write-Output 'commit-discipline:'
$i = 0
foreach ($g in $gaps) { $i++; Write-Output ("{0}. {1}" -f $i, $g) }
exit 1
`,
    },
];

async function seedGuardrailScripts(): Promise<void> {
    const now = new Date().toISOString();
    for (const s of GUARDRAIL_SCRIPT_SEEDS) {
        await db
            .insertInto('guardrail_scripts')
            .values({
                id: s.id,
                name: s.name,
                description: s.description,
                body_sh: s.body_sh,
                body_ps1: s.body_ps1,
                sort_order: s.sort_order,
            })
            .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                    name: s.name,
                    description: s.description,
                    body_sh: s.body_sh,
                    body_ps1: s.body_ps1,
                    sort_order: s.sort_order,
                    updated_at: now,
                }),
            )
            .execute();
    }
}

async function seedAgentTemplates(): Promise<void> {
    const now = new Date().toISOString();
    for (const tpl of AGENT_TEMPLATE_SEEDS) {
        await db
            .insertInto('agent_templates')
            .values({
                id: tpl.id,
                filename: tpl.filename,
                description: tpl.description,
                body_md: tpl.body_md,
                created_at: now,
                updated_at: now,
            })
            .onConflict((oc) =>
                oc.column('id').doUpdateSet({
                    filename: tpl.filename,
                    description: tpl.description,
                    body_md: tpl.body_md,
                    updated_at: now,
                }),
            )
            .execute();
    }
}

// `runSeed` is the single entry point for `pnpm db:seed`. It does ONE thing:
// sync the on-disk catalog (`packages/api/src/marketplace/catalog/`) into the
// `marketplace_agents` table. Idempotent — content_hash drives whether
// `version` bumps for each entry.
//
// It NEVER creates rows in the `agents` table. Agents exist only when the
// Owner installs them via `POST /api/marketplace/agents/:id/install`
// (`marketplaceService.install`). The earlier auto-install-on-boot path
// resurrected agents the Owner had deleted — see
// `.claude/plans/there-is-a-problem-zazzy-rivest.md`. Per-boot reconciliation
// of seed-shaped prompts on agents the Owner did install lives in
// `services/agent-defaults-sync.ts`.
export async function runSeed(): Promise<void> {
    assertRegulationsMatrixHealthy();

    const catalog = await syncMarketplaceCatalog();

    // Phase 2 — seed the five artifact templates so the templates-
    // assembler has rows to write per run. Idempotent via ON CONFLICT.
    await seedAgentTemplates();

    // Phase 3 — seed the 6 per-agent SDLC validation scripts so the
    // existing constitution-assembler pipeline writes them to
    // `.atlas/scripts/{bash,powershell}/check-<id>.{sh,ps1}` per
    // worktree. Idempotent via ON CONFLICT.
    await seedGuardrailScripts();

    console.log(
        `[db] seed: marketplace catalog synced (${catalog.length} entries) + ${GUARDRAIL_SCRIPT_SEEDS.length} guardrail scripts`
    );
}
