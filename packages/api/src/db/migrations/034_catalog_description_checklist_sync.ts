import type { Knex } from 'knex';

// Installed agents copy description and checklists from the marketplace
// catalog at install time; only prompt_md is re-synced on boot
// (agent-defaults-sync). The 2026-09-14 SDLC walkthrough fixes changed the
// catalog: Coder / Code Reviewer no longer claim pnpm-only gates or that the
// Coder opens the PR, and reviewer descriptions now say a rejection goes back
// to the writer. Rewrite installed rows ONLY where they still carry a prior
// catalog value, so Owner edits survive.

export const DESCRIPTION_UPDATES: ReadonlyArray<{ agentId: string; from: readonly string[]; to: string }> = [
    {
        agentId: "agent-coder",
        from: [
            "Picks up the dev Story Architect spec'd, reuses Architect's worktree, runs the spec-kit lifecycle (clarify/plan/task/implement/verify/analyze) committing each phase, raises a PR with `gh pr create`, comments the PR URL on the story, then removes the local worktree (remote branch survives as the PR head).",
        ],
        to: "Picks up the dev Story Architect spec'd, reuses Architect's worktree, runs the spec-kit lifecycle (clarify/plan/task/implement/verify/analyze) committing each phase, then hands off to Code Reviewer; the orchestrator pushes the branch and the Code Reviewer run opens the PR.",
    },
    {
        agentId: "agent-code-reviewer",
        from: [
            "Dedicated reviewer paired with `agent-coder`. Confirms PR diff covers every spec.md change, scans for anti-patterns, clones the PR head and runs `pnpm test`. Routes via the terminal `atlas-outcome` block (done → QA Writer, rejected → Owner, asked_question → Owner).",
            "Dedicated reviewer paired with `agent-coder`. Confirms PR diff covers every spec.md change, scans for anti-patterns, clones the PR head and runs the project's typecheck/lint gate. Routes via the terminal `atlas-outcome` block (done → QA Writer, rejected → Owner, asked_question → Owner).",
        ],
        to: "Dedicated reviewer paired with `agent-coder`. Confirms PR diff covers every spec.md change, scans for anti-patterns, clones the PR head and runs the project's typecheck/lint gate. Routes via the terminal `atlas-outcome` block (done → Owner with status `in_review` and the PR opened, rejected → Coder for revision, asked_question → Owner).",
    },
    {
        agentId: "agent-architect-reviewer",
        from: [
            "Dedicated reviewer paired with `agent-architect`. Fetches the spec from origin/<branch>, walks every required section, and routes via the terminal `atlas-outcome` block (done → Coder, rejected → Owner, asked_question → Owner).",
        ],
        to: "Dedicated reviewer paired with `agent-architect`. Fetches the spec from origin/<branch>, walks every required section, and routes via the terminal `atlas-outcome` block (done → Coder, rejected → Architect for revision, asked_question → Owner).",
    },
    {
        agentId: "agent-automation-reviewer",
        from: [
            "Dedicated reviewer paired with `agent-automation`. Confirms the PR head matches the QA Story's `worktree_branch` and targets `main`, walks the diff for `automation-yes` coverage from the QA test-plan CSV + `not automated:` roll-up comments for `automation-no` rows, scans new tests for anti-patterns (sleeps, brittle selectors, dangling promises), and runs the project test suite on the PR head. Routes via the terminal `atlas-outcome` block (done → Owner with status `in_review`, rejected → Owner, asked_question → Owner).",
        ],
        to: "Dedicated reviewer paired with `agent-automation`. Confirms the PR head matches the QA Story's `worktree_branch` and targets `main`, walks the diff for `automation-yes` coverage from the QA test-plan CSV + `not automated:` roll-up comments for `automation-no` rows, scans new tests for anti-patterns (sleeps, brittle selectors, dangling promises), and runs the project test suite on the PR head. Routes via the terminal `atlas-outcome` block (done → Owner with status `in_review`, rejected → Automation Engineer for revision, asked_question → Owner).",
    },
    {
        agentId: "agent-qa-reviewer",
        from: [
            "Dedicated reviewer paired with `agent-qa-writer`. Counts sub-tasks per (criterion × applicable kind), enforces the five-kind coverage floor, and verifies the `tested_by` link. Routes via the terminal `atlas-outcome` block (done → Owner, rejected → Owner, asked_question → Owner).",
        ],
        to: "Dedicated reviewer paired with `agent-qa-writer`. Parses the QA test-plan CSV, enforces the per-criterion five-kind coverage floor, and verifies the `tested_by` link. Routes via the terminal `atlas-outcome` block (done → Owner with status `in_review` and the PR opened, rejected → QA Writer for revision, asked_question → Owner).",
    },
];

export const CHECKLIST_LABEL_UPDATES: ReadonlyArray<{ agentId: string; from: string; to: string }> = [
    {
        agentId: 'agent-coder',
        from: 'pnpm typecheck clean across affected packages',
        to: 'Project typecheck and lint scripts clean (where declared)',
    },
    {
        agentId: 'agent-coder',
        from: 'pnpm test clean across affected packages',
        to: 'Project test suite clean',
    },
];

export async function up(knex: Knex): Promise<void> {
    for (const u of DESCRIPTION_UPDATES) {
        await knex('agents').where('id', u.agentId).whereIn('description', [...u.from]).update({ description: u.to });
    }
    for (const u of CHECKLIST_LABEL_UPDATES) {
        await knex('agent_checklists').where({ agent_id: u.agentId, label: u.from }).update({ label: u.to });
    }
}

export async function down(knex: Knex): Promise<void> {
    for (const u of DESCRIPTION_UPDATES) {
        const [first] = u.from;
        if (first !== undefined) {
            await knex('agents').where({ id: u.agentId, description: u.to }).update({ description: first });
        }
    }
    for (const u of CHECKLIST_LABEL_UPDATES) {
        await knex('agent_checklists').where({ agent_id: u.agentId, label: u.to }).update({ label: u.from });
    }
}
