import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { AGENT_SEEDS, GUARDRAIL_SCRIPT_SEEDS, HANDOFF_RULE_SEEDS, runSeed } from './seed.js';
import { db } from './kysely-client.js';
import { marketplaceService } from '../services/marketplace.js';
import { truncateAll } from '../../tests/_pg-db.js';

const BASELINE_SQL = readFileSync(
    resolve(__dirname, 'migrations', '001_baseline.sql'),
    'utf8',
);

// A07 — PO Writer brainstorms before drafting. The contract is baked into
// the seed prompt body so future re-installs and on-boot reconciliation
// carry the protocol forward.
describe('AGENT_SEEDS — A07 PO Writer brainstorm protocol', () => {
    const poWriter = AGENT_SEEDS.find((a) => a.id === 'agent-po-writer');

    it('seeds a row for agent-po-writer', () => {
        expect(poWriter).toBeDefined();
    });

    it("performer prompt contains a 'Brainstorming protocol' section", () => {
        // Heading level may evolve (v2 nested it under "## How you work" as
        // "### Step 4 — Brainstorming protocol"); the assertion is on the
        // section's existence, not its rendered depth.
        expect(poWriter?.prompt_md).toContain('Brainstorming protocol');
    });

    it("performer prompt prescribes the '## Brainstorm — open questions' comment prefix", () => {
        expect(poWriter?.prompt_md).toContain('## Brainstorm — open questions');
    });

    it('performer prompt no longer references Theme 10 (A11 was deferred)', () => {
        expect(poWriter?.prompt_md).not.toContain('Theme 10');
    });

    it("paired PO Reviewer agent's prompt_md contains the 'Special case — brainstorm exit' clause", () => {
        const poReviewer = AGENT_SEEDS.find((a) => a.id === 'agent-po-reviewer');
        expect(poReviewer?.prompt_md).toContain('Special case — brainstorm exit');
    });

    it("PO Reviewer prompt tells it to emit outcome 'needs_info' on a brainstorm exit", () => {
        const poReviewer = AGENT_SEEDS.find((a) => a.id === 'agent-po-reviewer');
        expect(poReviewer?.prompt_md).toMatch(/needs_info/);
        expect(poReviewer?.prompt_md).toContain('## Brainstorm — open questions');
    });

    it('Code Reviewer prompt does NOT carry the brainstorm-exit clause', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-code-reviewer');
        expect(reviewer?.prompt_md).not.toContain('Special case — brainstorm exit');
    });

    it('QA Reviewer prompt does NOT carry the brainstorm-exit clause', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-qa-reviewer');
        expect(reviewer?.prompt_md).not.toContain('Special case — brainstorm exit');
    });
});

// P1 — PO Writer v3 enhancement: every dev Story gets a `[QA]` twin
// linked back to the dev story via `tested_by`. The performer prompt
// gains a new Step 6; the reviewer prompt gains a hard-fail assertion
// with reason `missing_qa_story`. The handoff fans out from PO to both
// Architect and QA Writer.
describe('AGENT_SEEDS — P1 PO Writer v3 dev/QA twin', () => {
    const poWriter = AGENT_SEEDS.find((a) => a.id === 'agent-po-writer');

    it('performer prompt contains a Step 6 "Story duplication for testing" section', () => {
        expect(poWriter?.prompt_md).toContain('Story duplication for testing');
    });

    it('performer prompt instructs the agent to call `createItemLink` with kind "tested_by"', () => {
        expect(poWriter?.prompt_md).toContain('createItemLink');
        expect(poWriter?.prompt_md).toContain('tested_by');
    });

    it('performer prompt requires the QA twin title to carry the `[QA]` suffix', () => {
        expect(poWriter?.prompt_md).toContain('[QA]');
    });

    it("PO Reviewer agent's prompt asserts the QA twin pair exists (checklist item 8)", () => {
        const poReviewer = AGENT_SEEDS.find((a) => a.id === 'agent-po-reviewer');
        expect(poReviewer?.prompt_md).toContain('QA twin assertion');
        expect(poReviewer?.prompt_md).toContain('missing_qa_story');
    });

    it('PO Writer on-pass routes to PO Reviewer with status=ready', () => {
        const rules = HANDOFF_RULE_SEEDS.filter(
            (h) => h.agent_id === 'agent-po-writer' && h.kind === 'on-pass',
        );
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({
            target_agent_id: 'agent-po-reviewer',
            status: 'ready',
        });
    });

    it('PO Reviewer on-pass routes the epic to Owner with status=in_review (children dispatched from the prompt, not the handoff)', () => {
        const rules = HANDOFF_RULE_SEEDS.filter(
            (h) => h.agent_id === 'agent-po-reviewer' && h.kind === 'on-pass',
        );
        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({
            target_agent_id: 'owner',
            status: 'in_review',
        });
    });
});

// P1 — Deleted SDLC slugs. The 2026-05 redesign removes five obsolete
// agent rows (spec-writer, tester, devops, designer, security). Their
// seed entries must be gone so a fresh `runSeed()` doesn't reintroduce
// them. Migration 030 deletes the live rows for existing installs.
describe('AGENT_SEEDS — P1 deleted SDLC slugs', () => {
    const DELETED = [
        'agent-spec-writer',
        'agent-tester',
        'agent-devops',
        'agent-designer',
        'agent-security-reviewer',
    ];

    for (const slug of DELETED) {
        it(`does not include a seed row for ${slug}`, () => {
            expect(AGENT_SEEDS.find((a) => a.id === slug)).toBeUndefined();
        });
    }

    it('no HANDOFF_RULE_SEEDS row references a deleted slug', () => {
        for (const rule of HANDOFF_RULE_SEEDS) {
            expect(DELETED).not.toContain(rule.agent_id);
            expect(DELETED).not.toContain(rule.target_agent_id);
        }
    });
});

// Task 12 — the legacy `AGENT_SEEDS` / `sdlc-roles.ts` prompts (which
// still embed `performer_done` and `submit_review`) are no longer used
// at boot. `agent-defaults-sync` now reads from `marketplace_agents`,
// not `AGENT_SEEDS`, and the marketplace catalog prompts speak only of
// the unified `atlas-outcome` block. The seeds remain in the tree
// purely as input for `scripts/extract-seeds-to-catalog.ts`; runtime
// behaviour is covered by `prompt-builder.test.ts` and the
// `run-outcome-parser.test.ts` / `agent-runner-outcome-routing.test.ts`
// suites added under Task 12.

// 2026-05-31 — `agents.sort_order` is no longer used for UI ordering.
// `agentsService.list()` now orders by `name ASC` so the Agents + Queue
// pages render alphabetically (easier for Owner to scan/update). The
// `sort_order` column is retained as a monotonic 1..N schema invariant —
// each new seed gets a unique number, so future tooling that needs a
// stable per-agent integer (analytics buckets, fixed-column dashboards)
// has something to read. Migration 041 already converged live rows.
describe('AGENT_SEEDS — sort_order column invariants', () => {
    const EXPECTED_ORDER: ReadonlyArray<{ id: string; sort_order: number }> = [
        { id: 'agent-po-writer', sort_order: 1 },
        { id: 'agent-architect', sort_order: 2 },
        { id: 'agent-coder', sort_order: 3 },
        { id: 'agent-qa-writer', sort_order: 4 },
        { id: 'agent-automation', sort_order: 5 },
        { id: 'agent-jira-to-epic', sort_order: 6 },
        { id: 'agent-ai-readiness', sort_order: 7 },
        { id: 'agent-ai-news', sort_order: 8 },
        { id: 'agent-market-research', sort_order: 9 },
        { id: 'agent-regulations', sort_order: 10 },
        { id: 'agent-knowledge-base', sort_order: 11 },
        // T1 — the 5 dedicated SDLC reviewer agents land at 12..16.
        { id: 'agent-po-reviewer', sort_order: 12 },
        { id: 'agent-architect-reviewer', sort_order: 13 },
        { id: 'agent-code-reviewer', sort_order: 14 },
        { id: 'agent-qa-reviewer', sort_order: 15 },
        { id: 'agent-automation-reviewer', sort_order: 16 },
    ];

    it('each seed agent has the expected sort_order', () => {
        for (const { id, sort_order } of EXPECTED_ORDER) {
            const seed = AGENT_SEEDS.find((a) => a.id === id);
            expect(seed, `expected seed for ${id}`).toBeDefined();
            expect(seed?.sort_order, `${id} should have sort_order=${sort_order}`).toBe(sort_order);
        }
    });

    it('every seeded agent appears in EXPECTED_ORDER (no orphan ids)', () => {
        const expectedIds = new Set(EXPECTED_ORDER.map((e) => e.id));
        for (const seed of AGENT_SEEDS) {
            expect(expectedIds.has(seed.id), `agent ${seed.id} is missing from EXPECTED_ORDER — update this test alongside any new seed`).toBe(true);
        }
    });

    it('sort_order values are dense and unique (1..N)', () => {
        const orders = AGENT_SEEDS.map((a) => a.sort_order).sort((a, b) => a - b);
        const expected = Array.from({ length: AGENT_SEEDS.length }, (_, i) => i + 1);
        expect(orders).toEqual(expected);
    });
});

// 2026-05-31 — Agents page + Queue page render alphabetically by name.
// `agentsService.list()` is `ORDER BY name ASC`; this snapshot locks the
// expected sequence so a rename forces a deliberate test update.
describe('AGENT_SEEDS — alphabetical UI order (matches agentsService.list)', () => {
    const EXPECTED_ALPHABETICAL: ReadonlyArray<string> = [
        'agent-ai-news',                 // AI News Scout
        'agent-ai-readiness',            // AI Readiness Specialist
        'agent-architect',               // Architect
        'agent-architect-reviewer',      // Architect Reviewer
        'agent-automation',              // Automation Engineer
        'agent-automation-reviewer',     // Automation Reviewer
        // Code Reviewer sorts before Coder because "Code Reviewer" and
        // "Coder" share the prefix "Code", then `localeCompare` compares
        // ' ' (U+0020) against 'r' (U+0072) — the space wins.
        'agent-code-reviewer',           // Code Reviewer
        'agent-coder',                   // Coder
        'agent-jira-to-epic',            // Jira Importer
        'agent-knowledge-base',          // Knowledge Base Curator
        'agent-market-research',         // Market Research
        'agent-po-reviewer',             // PO Reviewer
        'agent-po-writer',               // PO Writer
        'agent-qa-reviewer',             // QA Reviewer
        'agent-qa-writer',               // QA Writer
        'agent-regulations',             // Regulations Scout
    ];

    it('every seed name is unique (so alphabetical order is deterministic)', () => {
        const names = AGENT_SEEDS.map((a) => a.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('sorted by name ASC produces the expected alphabetical sequence', () => {
        const byName = [...AGENT_SEEDS]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => a.id);
        expect(byName).toEqual(EXPECTED_ALPHABETICAL);
    });
});

// Utility agents on Haiku. The five non-SDLC agents that scrape /
// digest / import don't need Opus reasoning; the seed has them on
// `haiku` (the cli_models registry entry). Migration 040 reconciles
// existing installs that landed on the invented `claude-haiku-4-5`
// string from migrations 030 + 039.
describe('AGENT_SEEDS — utility agents on haiku', () => {
    const UTILITY_HAIKU = [
        'agent-ai-news',
        'agent-market-research',
        'agent-regulations',
        'agent-jira-to-epic',
        'agent-knowledge-base',
    ];

    for (const slug of UTILITY_HAIKU) {
        it(`${slug} ships with model = haiku`, () => {
            const agent = AGENT_SEEDS.find((a) => a.id === slug);
            expect(agent).toBeDefined();
            expect(agent?.model).toBe('haiku');
        });
    }
});

// P2 — Architect-cum-Spec-Writer v2 promotion. The architect performer
// prompt switches from the v1 "produce an architecture doc" starter to
// the worktree-spawning, spec-kit-driven flow. Migration 033 reconciles
// existing installs; the seed row flips to active with model
// `claude-opus-4-7[1m]` (1M-context variant, registry-backed) and
// schedule_hours = 3.
describe('AGENT_SEEDS — P2 Architect-cum-Spec-Writer v2', () => {
    const architect = AGENT_SEEDS.find((a) => a.id === 'agent-architect');

    it('seeds a row for agent-architect', () => {
        expect(architect).toBeDefined();
    });

    it('ships with status = active', () => {
        expect(architect?.status).toBe('active');
    });

    it('uses claude-sonnet-4-6 + claude CLI (model 045 walked off Opus)', () => {
        expect(architect?.model).toBe('claude-sonnet-4-6');
        expect(architect?.cli).toBe('claude');
    });

    it('runs every 3 hours', () => {
        expect(architect?.schedule_hours).toBe(3);
    });

    it('requires_item = true (dev story is the input)', () => {
        expect(architect?.requires_item).toBe(true);
    });

    // T2 — worktree provisioning moved into the non-AI orchestrator
    // (services/worktree-orchestrator.ts). The performer prompt now
    // documents the "harness already provisioned the worktree"
    // contract instead of telling the agent to run `git worktree add`
    // itself. The spec-kit flow + Coder handoff marker stay.
    it('performer prompt drives the spec-kit flow (worktree provisioning is delegated)', () => {
        expect(architect?.prompt_md).toContain('Worktree contract (T2)');
        expect(architect?.prompt_md).not.toContain('git worktree add');
        expect(architect?.prompt_md).toContain('specify');
        expect(architect?.prompt_md).toContain('Hand off to Coder');
    });

    it('performer prompt names the Husky workaround and references worktree_branch', () => {
        expect(architect?.prompt_md).toContain('worktree_branch');
        expect(architect?.prompt_md).toContain('core.hooksPath=.husky/_');
    });

    it('Plan E (056): prompt never instructs the agent to push or open a PR', () => {
        // 2026-06-01 (migration 056) reverses 054: the orchestrator owns
        // push + `gh pr create` again, gated on `agents.raises_pr`. The
        // performer prompt only commits — any `git push` / `gh pr create`
        // mention must be inside a negation, and the `execGitHub` token
        // must be gone.
        const md = architect?.prompt_md ?? '';
        for (const line of md.split('\n')) {
            if (line.includes('git push') || line.includes('gh pr create')) {
                expect(line).toMatch(/Do NOT|do NOT|not run|never run|never|Never|orchestrator/i);
            }
        }
        expect(md).not.toMatch(/mcp__atlas__execGitHub/);
        expect(md).not.toMatch(/execGitHub\(/);
    });

    it('B3: persists spec_md to the items row BEFORE any "Spec ready" comment', () => {
        // MON-2 (2026-05-31) was stranded because the prior prompt let
        // the agent post "Spec ready" before persisting the spec to
        // items.spec_md. The new step ordering moves the `updateItem`
        // call ahead of the comment.
        const md = architect?.prompt_md ?? '';
        // The persist step is mentioned.
        expect(md).toContain('Persist the spec to the dev Story');
        expect(md).toContain('updateItem({ issue_type: "story"');
        expect(md).toContain('spec_md');
        // The "What you never do" section forbids the old ordering.
        expect(md).toContain('updateItem({ spec_md })');
        // Both the persist step number and the comment step number
        // appear in the prompt (Step 6 = persist, Step 7 = comment).
        const persistIdx = md.indexOf('Step 6 — Persist the spec');
        const commentIdx = md.indexOf('Step 7 — Comment branch + spec path');
        expect(persistIdx).toBeGreaterThan(-1);
        expect(commentIdx).toBeGreaterThan(-1);
        expect(persistIdx).toBeLessThan(commentIdx);
    });

    it('T1: paired Architect Reviewer agent asserts spec sections and branch comment', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-architect-reviewer');
        expect(reviewer?.prompt_md).toBeTruthy();
        expect(reviewer?.prompt_md).toContain('spec assertion');
        expect(reviewer?.prompt_md).toContain('Feasibility');
    });

    it('Architect on-pass → Architect Reviewer (ready); Architect Reviewer on-pass → Coder (ready)', () => {
        const archOnPass = HANDOFF_RULE_SEEDS.find(
            (h) => h.agent_id === 'agent-architect' && h.kind === 'on-pass',
        );
        expect(archOnPass).toMatchObject({
            target_agent_id: 'agent-architect-reviewer',
            status: 'ready',
        });
        const reviewerOnPass = HANDOFF_RULE_SEEDS.find(
            (h) => h.agent_id === 'agent-architect-reviewer' && h.kind === 'on-pass',
        );
        expect(reviewerOnPass).toMatchObject({
            target_agent_id: 'agent-coder',
            status: 'ready',
        });
    });
});

// P3 — Coder v2 (spec-kit lifecycle + PR raise). The Coder performer
// prompt switches from the v1 "implement on a feature branch with TDD"
// starter to the worktree-reusing flow: reuse Architect's worktree, run
// `specify <phase>` + commit + push for each of `[clarify, plan, task,
// implement, verify, analyze]`, raise a PR with `gh pr create`, then
// `git worktree remove --force` (remote branch survives). Migration 034
// reconciles existing installs; the seed row flips to model
// `claude-sonnet-4-6` with `schedule_preset = 'every_n_hours'` and
// `schedule_hours = 1`. CLI stays `copilot`.
describe('AGENT_SEEDS — P3 Coder v2 spec-kit lifecycle', () => {
    const coder = AGENT_SEEDS.find((a) => a.id === 'agent-coder');

    it('seeds a row for agent-coder', () => {
        expect(coder).toBeDefined();
    });

    it('ships with status = active', () => {
        expect(coder?.status).toBe('active');
    });

    // Workstream #4 — Copilot CLI agents store the dot-form model
    // string the registry actually carries (`claude-sonnet-4.6`), NOT
    // the Claude-CLI hyphen form. The previous normalize-at-spawn
    // workaround in cli-model-naming.ts is gone; the data plane is the
    // authoritative source.
    it('uses claude-sonnet-4.6 (dot form, matches cli_models registry) + copilot CLI', () => {
        expect(coder?.model).toBe('claude-sonnet-4.6');
        expect(coder?.cli).toBe('copilot');
    });

    it('runs every_n_hours at 1-hour cadence with cron_expr = null', () => {
        expect(coder?.schedule_preset).toBe('every_n_hours');
        expect(coder?.schedule_hours).toBe(1);
        expect(coder?.cron_expr).toBeNull();
    });

    it('requires_item = true (dev story is the input)', () => {
        expect(coder?.requires_item).toBe(true);
    });

    it('performer prompt walks the six spec-kit phases', () => {
        expect(coder?.prompt_md).toContain('clarify');
        expect(coder?.prompt_md).toContain('plan');
        expect(coder?.prompt_md).toContain('task');
        expect(coder?.prompt_md).toContain('implement');
        expect(coder?.prompt_md).toContain('verify');
        expect(coder?.prompt_md).toContain('analyze');
    });

    // 2026-06-01 (Plan E / migration 056) — Coder commits; orchestrator
    // pushes; Code Reviewer's run opens the PR (its agent row has
    // `raises_pr = true`). The Coder prompt must NOT mention `execGitHub`
    // or instruct the agent to push / raise a PR.
    it('Plan E: Coder commits only — orchestrator pushes, reviewer opens PR', () => {
        const md = coder?.prompt_md ?? '';
        for (const line of md.split('\n')) {
            if (line.includes('git push') || line.includes('gh pr create')) {
                expect(line).toMatch(/Do NOT|do NOT|not run|never run|never|Never|orchestrator/i);
            }
        }
        expect(md).not.toMatch(/execGitHub/);
        // The prompt should name the new contract: orchestrator pushes,
        // reviewer opens PR.
        expect(md).toMatch(/orchestrator.*push|push.*orchestrator/i);
    });

    it('performer prompt does not call git worktree commands (T2)', () => {
        expect(coder?.prompt_md).not.toContain('git worktree add');
        expect(coder?.prompt_md).not.toContain('git worktree remove');
    });

    it('performer prompt references worktree_branch + Husky workaround', () => {
        expect(coder?.prompt_md).toContain('worktree_branch');
        expect(coder?.prompt_md).toContain('core.hooksPath=.husky/_');
    });

    // Workstream #3 (2026-06-02) — Coder used to be instructed to post a
    // "Hand off to QA Writer" comment and to claim the chain advanced to
    // QA Writer. Both were wrong (the immediate handoff is to Engineer
    // Reviewer) and the bogus claim leaked into every run summary. The
    // prompt and handoff_prompt_md must not name QA Writer in any
    // forward-looking routing context, and the "never do" list must ban
    // narrating routing at all.
    it('performer prompt does not narrate "Hand off to QA Writer" or claim the chain advances to QA Writer', () => {
        const md = coder?.prompt_md ?? '';
        expect(md).not.toMatch(/Hand off to QA Writer/);
        expect(md).not.toMatch(/chain advances to.*QA Writer/);
        // The "what you never do" list bans forward-looking routing.
        expect(md).toMatch(/Narrate routing/);
    });

    it('handoff_prompt_md drops the "to QA Writer" claim — the immediate next agent is the paired reviewer', () => {
        const handoff = coder?.handoff_prompt_md ?? '';
        expect(handoff).toContain('agent-code-reviewer');
        expect(handoff).not.toMatch(/chain advances to.*QA Writer/);
    });

    it('T1: paired Code Reviewer agent asserts the PR diff and runs typecheck + lint (NOT tests)', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-code-reviewer');
        expect(reviewer?.prompt_md).toBeTruthy();
        expect(reviewer?.prompt_md).toContain('PR diff assertion');
        expect(reviewer?.prompt_md).toContain('gh pr diff');
        expect(reviewer?.prompt_md).toContain('pnpm typecheck');
        expect(reviewer?.prompt_md).toContain('pnpm lint');
    });

    // Workstream (2026-06-03) — the "never execute the project's test
    // suite" rule moved from these four prompts into the global
    // `guardrail_rules` table (row id `seed-net-no-test-execution`,
    // category `side_effects_network`). Tests now enforce:
    //   (a) the prompts do NOT carry any bare test-runner invocation or
    //       the legacy never-do bullet, and
    //   (b) the baseline SQL seeds the new guardrail row with the
    //       expected category, severity, and rule text.
    it('Coder/Automation/Code Reviewer/Automation Reviewer prompts no longer carry test-ban text (moved to guardrails)', () => {
        const ids = [
            'agent-coder',
            'agent-automation',
            'agent-code-reviewer',
            'agent-automation-reviewer',
        ];
        const bannedTokens = [
            'pnpm test',
            'pnpm test:e2e',
            'vitest',
            'playwright test',
            'pytest',
            'go test',
            'cargo test',
            "Execute the project's test suite",
        ];
        for (const id of ids) {
            const seed = AGENT_SEEDS.find((a) => a.id === id);
            expect(seed, `${id} should be seeded`).toBeDefined();
            const md = seed?.prompt_md ?? '';
            for (const token of bannedTokens) {
                expect(md, `${id} prompt must not contain "${token}"`).not.toContain(token);
            }
        }
    });

    it('baseline SQL seeds the global no-test-execution guardrail row', () => {
        // The baseline SQL contains the INSERT for `seed-net-no-test-execution`
        // — a single source of truth that the constitution composer prepends
        // to every agent's compiled prompt at runtime.
        expect(BASELINE_SQL).toContain("'seed-net-no-test-execution'");
        expect(BASELINE_SQL).toContain("'side_effects_network'");
        expect(BASELINE_SQL).toMatch(
            /seed-net-no-test-execution.*side_effects_network.*Never execute the project''s test suite/s,
        );
        // Severity must be `block`, not `warn` or `ask_owner` — the rule is
        // categorical, not negotiable.
        expect(BASELINE_SQL).toMatch(/seed-net-no-test-execution[^\n]*'block'/);
    });

    // Unified worktree provisioning: every agent that commits code OR
    // produces a PR-worthy branch must carry `requires_worktree: true`
    // so the orchestrator provisions an isolated worktree, pushes the
    // branch, opens the PR, and cleans up — all through the same code
    // path. Research-only agents stay at the default `false`.
    it('every committing / authoring agent carries requires_worktree: true', () => {
        const requireWorktree = [
            'agent-po-writer',
            'agent-coder',
            'agent-qa-writer',
            'agent-architect',
            'agent-automation',
            'agent-po-reviewer',
            'agent-architect-reviewer',
            'agent-code-reviewer',
            'agent-qa-reviewer',
            'agent-automation-reviewer',
            'agent-ai-readiness',
            'agent-knowledge-base',
        ];
        for (const id of requireWorktree) {
            const seed = AGENT_SEEDS.find((a) => a.id === id);
            expect(seed, `${id} must be seeded`).toBeDefined();
            expect(seed?.requires_worktree, `${id} must require a worktree`).toBe(true);
        }
    });

    it('research-only agents do not require a worktree', () => {
        const noWorktree = [
            'agent-ai-news',
            'agent-market-research',
            'agent-regulations',
            'agent-jira-to-epic',
        ];
        for (const id of noWorktree) {
            const seed = AGENT_SEEDS.find((a) => a.id === id);
            expect(seed, `${id} must be seeded`).toBeDefined();
            // Either explicitly `false` or omitted (defaults to false at the
            // DB layer); both are acceptable.
            expect(seed?.requires_worktree ?? false, `${id} must NOT require a worktree`).toBe(
                false,
            );
        }
    });
});

// T3 — Coder Reviewer is the canonical owner of the dev-story
// finalisation. After the diff assertion clears, the reviewer re-runs
// the project-wide verification gate inside its own worktree, commits
// any stray work (Husky workaround + `Refs: <itemId>` trailer), pushes
// the dev branch, raises the PR via `gh pr create` (idempotent — reuses
// an existing PR if the performer already raised one), writes `pr_url`
// back onto the item, transitions to `in_review`, and assigns to
// Owner. The prompt-side checklist is the source of truth; the runtime
// is `--allowedTools` already including `Bash` for claude agents and
// the reviewer's `cli: 'copilot'` runs with `--allow-all-tools`, so
// the agent can shell out to `pnpm` / `git` / `gh` directly.
describe('AGENT_SEEDS — T3 Coder Reviewer raises PR via gh CLI', () => {
    const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-code-reviewer');

    it('seeds a row for agent-code-reviewer', () => {
        expect(reviewer).toBeDefined();
    });

    it('reviewer prompt opens a dedicated finalisation clause after the diff assertion', () => {
        expect(reviewer?.prompt_md).toContain(
            'Special case — finalise dev story after checklist pass',
        );
    });

    it('reviewer prompt re-runs the project-wide verification gate (typecheck + lint)', () => {
        const md = reviewer?.prompt_md ?? '';
        // The reviewer's verification gate is build-only (typecheck + lint).
        // The "no test execution" rule lives in the global guardrails — asserted
        // separately in the AGENT_SEEDS guardrail-row test above.
        expect(md).toContain('pnpm install --frozen-lockfile');
        expect(md).toContain('pnpm -r typecheck');
        expect(md).toContain('pnpm -r lint');
    });

    it("reviewer prompt routes the item back to the performer via MCP when the verification gate is red", () => {
        const md = reviewer?.prompt_md ?? '';
        // Post-handoff-realignment: a red gate is a revision case, not a
        // fail-handoff. The prompt drives the item back to agent-coder
        // itself using `assignItem` + `transitionItemStatus`, and the
        // runner's mid-run-reassignment guard skips the on-pass rule
        // when the agent emits `outcome: done` in the terminal block.
        expect(md).toContain('verification_gate_failed');
        expect(md).toContain('assignee_agent_id: "agent-coder"');
        expect(md).toMatch(/transitionItemStatus.*status: "ready"/);
    });

    it('reviewer prompt commits residue with the Husky workaround AND a `Refs:` trailer', () => {
        const md = reviewer?.prompt_md ?? '';
        expect(md).toContain('core.hooksPath=.husky/_');
        expect(md).toContain('Refs: <itemId>');
        // The commit-verifier (services/commit-verifier.ts) flags any
        // commit on a run that lacks the `Refs:` trailer as `partial`,
        // which surfaces a noisy audit comment. The prompt must name the
        // trailer explicitly so the LLM doesn't drop it.
        expect(md).toContain('git -c core.hooksPath=.husky/_ commit');
    });

    it('Plan E: reviewer does not push, does not call execGitHub — orchestrator opens the PR', () => {
        const md = reviewer?.prompt_md ?? '';
        // The reviewer's agent row carries `raises_pr = true`; the
        // orchestrator opens the PR after a clean exit. The prompt must
        // NOT instruct the reviewer to push or call execGitHub.
        expect(md).not.toMatch(/execGitHub/);
        // The prompt should name the new contract.
        expect(md).toMatch(/orchestrator|raises_pr/i);
    });

    it('reviewer prompt transitions the story to `in_review` and assigns back to Owner', () => {
        const md = reviewer?.prompt_md ?? '';
        expect(md).toContain('transitionItemStatus({ issue_type: "story", issue_id: "<itemId>", to: "in_review" })');
        expect(md).toContain('assignItem({ issue_type: "story", issue_id: "<itemId>", assignee_id: "owner" })');
    });

    // Task 12 — the `submit_review` MCP tool was retired. The reviewer
    // now emits a `atlas-outcome` block at end-of-run; the seed file
    // `sdlc-roles.ts` still embeds the old phrasing but is no longer
    // consumed at runtime (boot reconciliation reads from
    // `marketplace_agents`). Regression coverage for the new contract
    // lives in `prompt-builder.test.ts` and
    // `run-outcome-parser.test.ts`.
});

// 2026-06-03 — Comment-shape contract. The Atlas Constitution mandates that
// every agent's end-of-run comment carries the three-section "What I did /
// What I verified / Open questions / next steps" shape. Before this date,
// 5 of the 8 SDLC agents posted one-liners — the per-prompt examples
// contradicted the constitution, and the orchestrator's de-dup logic
// (`agent-runner.ts:727`) suppressed the auto-summary post when any (even
// short) comment from the agent existed. These tests lock in the section
// headers in every SDLC agent's prompt so future drift trips a test rather
// than landing as bad data on items. See
// docs/plans/i-want-to-create-radiant-wirth.md.
describe('AGENT_SEEDS — comment-shape contract (What I did / Verified / Next)', () => {
    const SDLC_AGENT_IDS: readonly string[] = [
        'agent-po-writer',
        'agent-po-reviewer',
        'agent-architect',
        'agent-architect-reviewer',
        'agent-coder',
        'agent-code-reviewer',
        'agent-qa-writer',
        'agent-qa-reviewer',
        'agent-automation',
        'agent-automation-reviewer',
    ];
    const REQUIRED_SECTIONS = ['**What I did:**', '**What I verified:**', '**Open questions / next steps:**'];

    for (const agentId of SDLC_AGENT_IDS) {
        it(`${agentId} prompt embeds all three structured-shape section headers`, () => {
            const md = AGENT_SEEDS.find((a) => a.id === agentId)?.prompt_md ?? '';
            for (const header of REQUIRED_SECTIONS) {
                expect(
                    md.includes(header),
                    `${agentId} prompt missing required section header ${header}`,
                ).toBe(true);
            }
        });
    }

    // Anti-drift: catch the specific one-liner phrases that were the
    // smoking gun before 2026-06-03. If a future prompt edit reintroduces
    // any of them, this test fails loudly.
    const FORBIDDEN_ONE_LINER_PHRASES: ReadonlyArray<{ agentId: string; phrase: string }> = [
        // QA Writer Step 7 used to say "Post a one-line comment on the QA Story:"
        { agentId: 'agent-qa-writer', phrase: 'Post a one-line comment' },
        // Reviewer factory used to say "Post a single-line approval comment"
        { agentId: 'agent-po-reviewer', phrase: 'Post a single-line approval comment' },
        { agentId: 'agent-code-reviewer', phrase: 'Post a single-line approval comment' },
        { agentId: 'agent-architect-reviewer', phrase: 'Post a single-line approval comment' },
        { agentId: 'agent-qa-reviewer', phrase: 'Post a single-line approval comment' },
        { agentId: 'agent-automation-reviewer', phrase: 'Post a single-line approval comment' },
    ];
    for (const { agentId, phrase } of FORBIDDEN_ONE_LINER_PHRASES) {
        it(`${agentId} prompt no longer says ${JSON.stringify(phrase)}`, () => {
            const md = AGENT_SEEDS.find((a) => a.id === agentId)?.prompt_md ?? '';
            expect(md).not.toContain(phrase);
        });
    }
});

// P4 — QA Writer v2. The QA Writer prompt switches from "author Gherkin
// scenarios + run them green" to a planning role: read the QA Story's
// `tested_by` dev Story, walk each acceptance criterion, file a sub-task
// per (criterion × applicable kind) across five kinds (API / UI / E2E /
// Integration / Regression), tag each sub-task `[automation_candidate]`
// or `[manual_only]`. Seed row flips to Opus + 2h cadence; migration 035
// reconciles existing installs.
describe('AGENT_SEEDS — P4 QA Writer v2', () => {
    const qa = AGENT_SEEDS.find((a) => a.id === 'agent-qa-writer');

    it('seeds a row for agent-qa-writer', () => {
        expect(qa).toBeDefined();
    });

    it('ships with status = active', () => {
        expect(qa?.status).toBe('active');
    });

    it('uses claude-sonnet-4-6 + claude CLI (model 045 walked off Opus)', () => {
        expect(qa?.model).toBe('claude-sonnet-4-6');
        expect(qa?.cli).toBe('claude');
    });

    it('runs every 2 hours', () => {
        expect(qa?.schedule_hours).toBe(2);
    });

    it('performer prompt covers all five test kinds', () => {
        // v3 renamed the kinds to the canonical Labels-friendly slugs.
        expect(qa?.prompt_md).toContain('functional');
        expect(qa?.prompt_md).toContain('integration');
        expect(qa?.prompt_md).toContain('e2e');
        expect(qa?.prompt_md).toContain('edge');
        expect(qa?.prompt_md).toContain('regression');
    });

    it('performer prompt names both automation labels', () => {
        // CSV pivot — the [automation_candidate] / [manual_only] tags
        // are gone, replaced by Labels-cell `automation-yes` /
        // `automation-no` values.
        expect(qa?.prompt_md).toContain('automation-yes');
        expect(qa?.prompt_md).toContain('automation-no');
        expect(qa?.prompt_md).not.toContain('[automation_candidate]');
        expect(qa?.prompt_md).not.toContain('[manual_only]');
    });

    it('performer prompt requires a `tested_by` link to the dev Story', () => {
        expect(qa?.prompt_md).toContain('tested_by');
        expect(qa?.prompt_md).toContain('missing_tested_by_link');
    });

    it('performer prompt drives the CSV writer flow (no sub-task creation)', () => {
        // QA Writer v3 — no DB sub-tasks. The artefact is the CSV at
        // tests/qa/<storyId>.csv committed to the QA branch.
        const md = qa?.prompt_md ?? '';
        // The literal string `createSubTask` may appear ONLY inside a
        // negation (e.g. the "Do not call createSubTask" line in the
        // "What you never do" section). Anywhere else is the old flow.
        for (const line of md.split('\n')) {
            if (line.includes('createSubTask')) {
                expect(line).toMatch(/[Nn]ever|must not|[Dd]o not|[Dd]o NOT|Don't|no createStory|are gone/);
            }
        }
        expect(md).toContain('tests/qa/');
        expect(md).toContain('Summary,Description,Issue Type,Priority,Labels,Components');
    });

    it('Plan E: QA Writer commits only — orchestrator pushes the CSV', () => {
        const md = qa?.prompt_md ?? '';
        for (const line of md.split('\n')) {
            if (line.includes('git push')) {
                expect(line).toMatch(/Do NOT|do NOT|not run|never run|never|Never|orchestrator/i);
            }
        }
        expect(md).not.toMatch(/execGitHub/);
        expect(md).toMatch(/orchestrator/i);
    });

    it('T1: paired QA Reviewer agent asserts CSV coverage', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-qa-reviewer');
        expect(reviewer?.prompt_md).toBeTruthy();
        // v2 renamed the special-case clause for the CSV pivot.
        expect(reviewer?.prompt_md).toContain('QA test-plan CSV assertion');
        expect(reviewer?.prompt_md).toContain('insufficient_coverage');
        expect(reviewer?.prompt_md).toContain('missing_test_plan_csv');
        expect(reviewer?.prompt_md).toContain('bad_test_plan_csv');
        // Old tag taxonomy must be gone on the reviewer too.
        expect(reviewer?.prompt_md).not.toContain('[automation_candidate]');
        expect(reviewer?.prompt_md).not.toContain('[manual_only]');
    });
});

// P5 — Automation Engineer v2 promotion. The automation performer prompt
// switches from the v1 "CI/CD pipelines" starter to the dev-PR-gated,
// project-automation-repo cloning, sub-task-driven test-automation flow.
// Migration 036 reconciles existing installs; the seed row flips to
// active with model `claude-sonnet-4-6`, cli `copilot`, schedule_hours = 2.
describe('AGENT_SEEDS — P5 Automation Engineer v2', () => {
    const automation = AGENT_SEEDS.find((a) => a.id === 'agent-automation');

    it('seeds a row for agent-automation', () => {
        expect(automation).toBeDefined();
    });

    it('ships with status = active', () => {
        expect(automation?.status).toBe('active');
    });

    // Workstream #4 — same dot-form requirement as Coder; see the
    // analogous test in the Coder block.
    it('uses claude-sonnet-4.6 (dot form, matches cli_models registry) + copilot CLI', () => {
        expect(automation?.model).toBe('claude-sonnet-4.6');
        expect(automation?.cli).toBe('copilot');
    });

    it('runs every 2 hours', () => {
        expect(automation?.schedule_hours).toBe(2);
    });

    it('requires_item = true (QA story is the input)', () => {
        expect(automation?.requires_item).toBe(true);
    });

    it('automation performer prompt drives the dev-PR-MERGED gate (read-only `gh pr view`)', () => {
        // Plan E — execGitHub is gone. Read-only `gh pr view` is fine via
        // Bash; only mutations (push, pr_create, pr_edit) are forbidden.
        expect(automation?.prompt_md).toMatch(/gh pr view/);
        expect(automation?.prompt_md).toContain('MERGED');
    });

    it('performer prompt distinguishes automation-yes vs automation-no CSV rows', () => {
        // CSV pivot — the sub-task tags are gone; the agent now reads
        // the QA writer's CSV and splits on Labels cell values.
        expect(automation?.prompt_md).toContain('automation-yes');
        expect(automation?.prompt_md).toContain('automation-no');
        expect(automation?.prompt_md).toContain('tests/qa/');
    });

    // Workstream #3 — the automation engineer runs INSIDE the
    // harness-provisioned worktree on the QA Story's `worktree_branch`
    // (NOT a fresh `atlas/auto/<id>` branch — ROLE_BRANCH_OVERRIDES is
    // gone). The performer commits; the orchestrator pushes; the
    // Automation Reviewer's clean exit opens the PR against `main` (its
    // agent row carries `raises_pr = true`). The QA Story transitions
    // to `in_review`.
    it('performer prompt commits on the harness-provisioned worktree branch, never on atlas/auto/<id>', () => {
        const md = automation?.prompt_md ?? '';
        // ROLE_BRANCH_OVERRIDES is gone — no `atlas/auto/` literals
        // anywhere in the prompt. The branch is whatever the harness
        // wrote into the worktree preamble (the QA Story's worktree_branch).
        expect(md).not.toContain('atlas/auto/');
        expect(md).not.toMatch(/execGitHub/);
        expect(md).toContain('in_review');
        // Names the new contract.
        expect(md).toMatch(/orchestrator|raises_pr/i);
        // Points at the QA Story's branch as the source-of-truth.
        expect(md).toMatch(/worktree_branch|QA Story's `worktree_branch`/);
    });

    // T4 — the prompt MUST tell the agent that the worktree is
    // pre-provisioned by the harness. It MUST NOT clone a separate
    // automation repo or reuse the QA writer's branch.
    it('performer prompt does not clone a separate automation repo (T4)', () => {
        expect(automation?.prompt_md).not.toContain('git clone');
        expect(automation?.prompt_md).not.toContain('automation_repo_url');
    });

    it('performer prompt references the Husky commit workaround', () => {
        expect(automation?.prompt_md).toContain('core.hooksPath=.husky/_');
    });

    it('performer prompt does not call git worktree commands or git checkout -b (T2/T4)', () => {
        // T4 — the harness pre-provisions the worktree, so the prompt
        // explicitly forbids the agent from running `git worktree add`
        // / `git pull` / `git fetch` / `git checkout <branch>`. The
        // string `git worktree add` therefore appears in the prompt
        // ONLY inside an explicit negation ("must not", "Never run",
        // "via Bash", etc.). `git checkout -b` is absent entirely.
        const md = automation?.prompt_md ?? '';
        expect(md).not.toContain('git checkout -b');
        for (const line of md.split('\n')) {
            if (line.includes('git worktree add')) {
                expect(line).toMatch(/[Nn]ever|must not|[Dd]o not|[Dd]o NOT|Don't|via Bash/);
            }
        }
    });

    it('Plan E: Automation commits only — orchestrator pushes, reviewer opens the PR', () => {
        const md = automation?.prompt_md ?? '';
        for (const line of md.split('\n')) {
            if (line.includes('git push') || line.includes('gh pr create')) {
                expect(line).toMatch(/Do NOT|do NOT|not run|never run|never|Never|orchestrator/i);
            }
        }
        expect(md).not.toMatch(/execGitHub/);
    });

    it('T1: paired Automation Reviewer agent asserts automation PR coverage on the PR head', () => {
        const reviewer = AGENT_SEEDS.find((a) => a.id === 'agent-automation-reviewer');
        const md = reviewer?.prompt_md ?? '';
        expect(md).toBeTruthy();
        expect(md).toContain('automation PR assertion');
        // Plan E — diff is walked via local `git diff`; execGitHub is gone.
        expect(md).toMatch(/git diff origin\/main/);
        expect(md).not.toMatch(/execGitHub/);
        // Workstream #3 — reviewer verifies the PR head matches the QA
        // Story's `worktree_branch`, NOT a fresh `atlas/auto/<id>`.
        expect(md).not.toContain('atlas/auto/');
        expect(md).toMatch(/worktree_branch/);
        // CSV pivot — reviewer checks coverage against the QA writer's
        // CSV (automation-yes rows), not against sub-task tags.
        expect(md).toContain('tests/qa/');
        expect(md).toContain('automation-yes');
    });
});

// 2026-05-30 — Jira Importer prompt shape. The v2 prompt fixes the
// over-strict `<YOUR-...>`-scanning validator by introducing two
// unambiguous sentinel slots (`<<TARGET-ATLAS-PROJECT>>` and
// `<<JIRA-JQL>>`) plus a Starting README at the top telling the Owner
// exactly which two strings to replace. Imported epics now carry the
// `[<JIRA-KEY>]` title prefix and consolidate Jira comments into the
// description.
describe('AGENT_SEEDS — Jira Importer prompt v2 shape', () => {
    const jira = AGENT_SEEDS.find((a) => a.id === 'agent-jira-to-epic');

    it('opens with a Starting README header', () => {
        expect(jira?.prompt_md).toContain('Starting README');
    });

    it('carries the two unambiguous sentinel slots', () => {
        expect(jira?.prompt_md).toContain('<<TARGET-ATLAS-PROJECT>>');
        expect(jira?.prompt_md).toContain('<<JIRA-JQL>>');
    });

    it('prescribes the `[<JIRA-KEY>] <summary>` title format', () => {
        // The createEpic example block in the prompt must show the
        // bracketed key prefix so the agent reproduces it.
        expect(jira?.prompt_md).toContain('[<JIRA-KEY>] <jira summary>');
    });

    it('instructs full-fetch via getJiraIssue with `comment` in fields', () => {
        expect(jira?.prompt_md).toContain('getJiraIssue');
        expect(jira?.prompt_md).toContain("'comment'");
    });

    it('describes the consolidated description shape with a Comments section + Source footer', () => {
        expect(jira?.prompt_md).toContain('## Comments');
        expect(jira?.prompt_md).toContain('Source:');
    });
});

// 2026-05-30 — Self-contained agents (Jira Importer, AI Readiness,
// AI News, Market Research, Regulations, Knowledge Base) route both
// on-pass and on-fail back to the Owner via the `target_agent_id =
// 'owner'` sentinel. Migration 042 backfills existing live DBs.
describe('HANDOFF_RULE_SEEDS — self-contained agents route to Owner', () => {
    const SELF_CONTAINED = [
        'agent-jira-to-epic',
        'agent-ai-readiness',
        'agent-ai-news',
        'agent-market-research',
        'agent-regulations',
        'agent-knowledge-base',
    ];

    for (const slug of SELF_CONTAINED) {
        it(`${slug} has on-pass → owner (status=done)`, () => {
            const rule = HANDOFF_RULE_SEEDS.find(
                (r) => r.agent_id === slug && r.kind === 'on-pass',
            );
            expect(rule, `${slug} missing on-pass rule`).toBeDefined();
            expect(rule?.target_agent_id).toBe('owner');
            expect(rule?.status).toBe('done');
        });

        it(`${slug} has on-fail → owner (status=waiting_for_info)`, () => {
            const rule = HANDOFF_RULE_SEEDS.find(
                (r) => r.agent_id === slug && r.kind === 'on-fail',
            );
            expect(rule, `${slug} missing on-fail rule`).toBeDefined();
            expect(rule?.target_agent_id).toBe('owner');
            expect(rule?.status).toBe('waiting_for_info');
        });
    }
});

// 2026-05-31 — Handoff rules realignment. Migration 048 normalises the
// SDLC slice into a uniform 20-row matrix (10 agents × 2 kinds):
//   - Performer on-pass → paired reviewer with `ready`
//   - Architect Reviewer on-pass → Coder with `ready` (mid-chain handoff)
//   - All other reviewers on-pass → Owner with `in_review`
//   - Every SDLC agent on-fail → Owner with `waiting_for_info`
// The PO Reviewer fan-out (Architect + QA Writer) was retired; the
// reviewer dispatches its epic's children from the prompt via Atlas MCP.
// Reviewer→performer revision loops were also retired; the reviewer
// uses MCP to reassign and the runner's mid-run-reassignment guard
// (in agent-runner.ts) silently skips the on-pass rule when the agent
// already routed the item.
describe('HANDOFF_RULE_SEEDS — SDLC matrix (2026-05-31 realign)', () => {
    const SDLC_AGENTS = [
        'agent-po-writer',
        'agent-po-reviewer',
        'agent-architect',
        'agent-architect-reviewer',
        'agent-coder',
        'agent-code-reviewer',
        'agent-qa-writer',
        'agent-qa-reviewer',
        'agent-automation',
        'agent-automation-reviewer',
    ] as const;

    const EXPECTED_ON_PASS: Record<string, { target: string; status: string }> = {
        'agent-po-writer': { target: 'agent-po-reviewer', status: 'ready' },
        'agent-po-reviewer': { target: 'owner', status: 'in_review' },
        'agent-architect': { target: 'agent-architect-reviewer', status: 'ready' },
        'agent-architect-reviewer': { target: 'agent-coder', status: 'ready' },
        'agent-coder': { target: 'agent-code-reviewer', status: 'ready' },
        'agent-code-reviewer': { target: 'owner', status: 'in_review' },
        'agent-qa-writer': { target: 'agent-qa-reviewer', status: 'ready' },
        'agent-qa-reviewer': { target: 'owner', status: 'in_review' },
        'agent-automation': { target: 'agent-automation-reviewer', status: 'ready' },
        'agent-automation-reviewer': { target: 'owner', status: 'in_review' },
    };

    for (const slug of SDLC_AGENTS) {
        it(`${slug} has exactly one on-pass row matching the realign matrix`, () => {
            const rules = HANDOFF_RULE_SEEDS.filter(
                (r) => r.agent_id === slug && r.kind === 'on-pass',
            );
            expect(rules, `${slug} should have exactly one on-pass rule`).toHaveLength(1);
            const expected = EXPECTED_ON_PASS[slug]!;
            expect(rules[0]).toMatchObject({
                target_agent_id: expected.target,
                status: expected.status,
            });
        });

        it(`${slug} has exactly one on-fail row routing to Owner / waiting_for_info`, () => {
            const rules = HANDOFF_RULE_SEEDS.filter(
                (r) => r.agent_id === slug && r.kind === 'on-fail',
            );
            expect(rules, `${slug} should have exactly one on-fail rule`).toHaveLength(1);
            expect(rules[0]).toMatchObject({
                target_agent_id: 'owner',
                status: 'waiting_for_info',
            });
        });
    }

    it('no SDLC agent has more than one rule per kind (fan-out retired)', () => {
        for (const slug of SDLC_AGENTS) {
            const onPass = HANDOFF_RULE_SEEDS.filter(
                (r) => r.agent_id === slug && r.kind === 'on-pass',
            );
            const onFail = HANDOFF_RULE_SEEDS.filter(
                (r) => r.agent_id === slug && r.kind === 'on-fail',
            );
            expect(onPass.length, `${slug} on-pass count`).toBe(1);
            expect(onFail.length, `${slug} on-fail count`).toBe(1);
        }
    });

    it('no SDLC reviewer routes on-fail back to its paired performer (revision loop is now prompt-driven)', () => {
        const reviewerPairs: Array<[string, string]> = [
            ['agent-po-reviewer', 'agent-po-writer'],
            ['agent-architect-reviewer', 'agent-architect'],
            ['agent-code-reviewer', 'agent-coder'],
            ['agent-qa-reviewer', 'agent-qa-writer'],
            ['agent-automation-reviewer', 'agent-automation'],
        ];
        for (const [reviewer, performer] of reviewerPairs) {
            const stale = HANDOFF_RULE_SEEDS.find(
                (r) =>
                    r.agent_id === reviewer &&
                    r.kind === 'on-fail' &&
                    r.target_agent_id === performer,
            );
            expect(
                stale,
                `${reviewer} on-fail must not target ${performer} — migration 048 moved revisions out of handoffs`,
            ).toBeUndefined();
        }
    });
});

// P1 — Jira importer schedule moves from every-4-hours to daily 09:00.
describe('AGENT_SEEDS — P1 Jira importer schedule', () => {
    const jira = AGENT_SEEDS.find((a) => a.id === 'agent-jira-to-epic');

    it('uses schedule_preset = "daily"', () => {
        expect(jira?.schedule_preset).toBe('daily');
    });

    it('fires at 09:00', () => {
        expect(jira?.schedule_time_of_day).toBe('09:00');
    });

    it('does not also carry schedule_hours / cron_expr (preset is the source of truth)', () => {
        expect(jira?.schedule_hours).toBeUndefined();
        expect(jira?.cron_expr).toBeNull();
    });
});

// 2026-06-04 — runSeed never creates rows in `agents`. The on-disk catalog
// is synced into `marketplace_agents` (so the Marketplace UI lists every
// entry as "Install"); users install what they need via
// `POST /api/marketplace/agents/:id/install`. This reverses the prior
// "B17 idempotent top-up" contract — auto-installing every catalog entry
// on every boot resurrected agents the Owner had explicitly deleted. See
// `.claude/plans/there-is-a-problem-zazzy-rivest.md`.
describe('runSeed — agents table is owned by marketplace install, not the seed', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('leaves the agents table empty on a fresh install', async () => {
        await runSeed();
        const rows = await db.selectFrom('agents').select('id').execute();
        expect(rows).toEqual([]);
    });

    it('still syncs the on-disk catalog into marketplace_agents', async () => {
        await runSeed();
        const catalog = await db.selectFrom('marketplace_agents').select('id').execute();
        // Every AGENT_SEEDS entry has a matching on-disk catalog folder, so
        // marketplace_agents must include at least that many rows.
        expect(catalog.length).toBeGreaterThanOrEqual(AGENT_SEEDS.length);
    });

    it('does not resurrect an agent the Owner deleted (the bug this plan fixes)', async () => {
        await runSeed();
        await marketplaceService.install('agent-knowledge-base');
        // Hard-delete via the same path the API DELETE handler uses
        // (services/agents.ts:517). FKs CASCADE clean up dependents.
        await db.deleteFrom('agents').where('id', '=', 'agent-knowledge-base').execute();
        await runSeed();
        const row = await db
            .selectFrom('agents')
            .select('id')
            .where('id', '=', 'agent-knowledge-base')
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });

    it('does not touch agents the Owner edited (prompt_version > 1)', async () => {
        await runSeed();
        await marketplaceService.install('agent-po-writer');
        const ownerEdit = '# OWNER-EDITED PROMPT — do not overwrite';
        await db
            .updateTable('agents')
            .set({ prompt_md: ownerEdit, prompt_version: 5 })
            .where('id', '=', 'agent-po-writer')
            .execute();
        await runSeed();
        const row = await db
            .selectFrom('agents')
            .select(['prompt_md', 'prompt_version'])
            .where('id', '=', 'agent-po-writer')
            .executeTakeFirst();
        expect(row?.prompt_md).toBe(ownerEdit);
        expect(row?.prompt_version).toBe(5);
    });
});

// Phase 3 — 6 per-agent SDLC validation scripts land in
// `guardrail_scripts`. The `constitution-assembler` pipeline writes
// them as `.atlas/scripts/{bash,powershell}/check-<id>.{sh,ps1}` per
// worktree; the per-agent slash-command bodies invoke them before
// emitting `outcome: done`. Idempotent via ON CONFLICT (id) DO UPDATE.
describe('GUARDRAIL_SCRIPT_SEEDS — Phase 3 per-agent validators', () => {
    const EXPECTED_IDS = [
        'prereqs',
        'po-writer-output',
        'architect-spec-md',
        'coder-tests-green',
        'qa-writer-csv',
        // 2026-06-09 — Automation Engineer gate added (the prompt referenced
        // this script for months, but the seed was missing it; both
        // agent-automation and agent-automation-reviewer were silently
        // substituting `pnpm typecheck + pnpm lint`).
        'check-automation-tests',
        'commit-discipline',
    ] as const;

    it('exports 7 seeds with the canonical ids', () => {
        expect(GUARDRAIL_SCRIPT_SEEDS).toHaveLength(EXPECTED_IDS.length);
        const ids = GUARDRAIL_SCRIPT_SEEDS.map((s) => s.id).sort();
        expect(ids).toEqual([...EXPECTED_IDS].sort());
    });

    it('every seed carries non-empty body_sh and body_ps1', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            expect(seed.body_sh.length, `${seed.id} body_sh`).toBeGreaterThan(0);
            expect(seed.body_ps1.length, `${seed.id} body_ps1`).toBeGreaterThan(0);
        }
    });

    it('every PowerShell body is pure ASCII (PS 5.1 parser compat)', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            for (let i = 0; i < seed.body_ps1.length; i++) {
                const c = seed.body_ps1.charCodeAt(i);
                expect(
                    c,
                    `${seed.id} body_ps1 char ${i} (${JSON.stringify(seed.body_ps1.slice(Math.max(0, i - 10), i + 10))}) must be ASCII`,
                ).toBeLessThan(128);
            }
        }
    });

    it('each script body is <= 80 lines (per the plan budget)', () => {
        for (const seed of GUARDRAIL_SCRIPT_SEEDS) {
            const shLines = seed.body_sh.split('\n').length;
            const psLines = seed.body_ps1.split('\n').length;
            expect(shLines, `${seed.id} bash lines`).toBeLessThanOrEqual(80);
            expect(psLines, `${seed.id} powershell lines`).toBeLessThanOrEqual(80);
        }
    });

    describe('runSeed seeds guardrail_scripts rows', () => {
        beforeEach(async () => {
            await truncateAll();
        });

        it('inserts all 6 rows on a fresh DB', async () => {
            await runSeed();
            const rows = await db
                .selectFrom('guardrail_scripts')
                .select(['id', 'name', 'body_sh', 'body_ps1'])
                .where('id', 'in', [...EXPECTED_IDS])
                .execute();
            const byId = new Map(rows.map((r) => [r.id, r]));
            for (const id of EXPECTED_IDS) {
                const row = byId.get(id);
                expect(row, `${id} should be seeded`).toBeDefined();
                expect(row?.body_sh.length).toBeGreaterThan(0);
                expect(row?.body_ps1.length).toBeGreaterThan(0);
            }
        });

        it('is idempotent — running twice keeps exactly one row per id', async () => {
            await runSeed();
            await runSeed();
            const rows = await db
                .selectFrom('guardrail_scripts')
                .select(['id'])
                .where('id', 'in', [...EXPECTED_IDS])
                .execute();
            expect(rows).toHaveLength(EXPECTED_IDS.length);
            const ids = rows.map((r) => r.id).sort();
            expect(ids).toEqual([...EXPECTED_IDS].sort());
        });

        it('ON CONFLICT updates the body when the seed source changes', async () => {
            await runSeed();
            // Stomp a body to simulate stale on-disk data.
            await db
                .updateTable('guardrail_scripts')
                .set({ body_sh: 'STALE', body_ps1: 'STALE' })
                .where('id', '=', 'prereqs')
                .execute();
            await runSeed();
            const row = await db
                .selectFrom('guardrail_scripts')
                .select(['body_sh', 'body_ps1'])
                .where('id', '=', 'prereqs')
                .executeTakeFirstOrThrow();
            expect(row.body_sh).not.toBe('STALE');
            expect(row.body_ps1).not.toBe('STALE');
            const seed = GUARDRAIL_SCRIPT_SEEDS.find((s) => s.id === 'prereqs')!;
            expect(row.body_sh).toBe(seed.body_sh);
            expect(row.body_ps1).toBe(seed.body_ps1);
        });
    });
});
