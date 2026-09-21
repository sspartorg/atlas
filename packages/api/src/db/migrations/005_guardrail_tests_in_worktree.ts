import type { Knex } from 'knex';

// `seed-net-no-test-execution` — narrow the blanket test-execution ban to
// "not outside your own worktree".
//
// The seeded rule banned every test runner outright, with the rationale that
// CI is the merge gate. Three catalog agents nevertheless carry a *required*
// checklist row that can only be satisfied by executing tests:
//
//   agent-coder               "Project test suite clean"
//   agent-code-reviewer       "Full project test suite green — ran
//                              check-coder-tests-green.sh <itemId> --run-tests"
//   agent-automation-reviewer "Automated tests execute green, not merely parse"
//
// Those two defaults contradict each other, and the contradiction is not
// cosmetic: on a fresh install every dev sub-task and every code review halts
// with `checklist_failed` and escalates to the Owner, so the autonomous
// delivery workflow stops on every single Task. Observed end-to-end on
// 2026-09-22 (ATL-1: coder parked, then code-reviewer parked citing the same
// conflict on its own row 21).
//
// The checklists are the part worth keeping — "executes green, not merely
// parse" is the whole point of the automation reviewer — so the rule gives way
// instead. It stays `block`, because it still blocks a real boundary: running
// the suite anywhere other than the agent's own item worktree. A local pass
// remains evidence for a checklist, never the merge gate.

const ID = 'seed-net-no-test-execution';

const NEW_RULE =
    'Run the project test suite only inside the worktree Atlas provisioned for the item you are working on. Never run it anywhere else, and never treat a local pass as the merge gate.';

const NEW_DETAIL =
    'Test runners (pnpm test, vitest, jest, mocha, playwright test, cypress, pytest, go test, cargo test, rspec, phpunit) are ALLOWED inside your own item worktree, so a reviewer can confirm tests execute green rather than merely parse. They stay BLOCKED everywhere else: never against the main checkout, another item worktree, or any deployed environment. A local pass is evidence for your checklist, not the merge gate - that remains .github/workflows/test.yml.';

const OLD_RULE =
    "Never execute the project's test suite. CI gates every merge; local test runs burn tokens without adding signal.";

const OLD_DETAIL =
    'Bans every test runner: pnpm test, pnpm test:e2e, vitest, jest, mocha, playwright test, cypress, pytest, go test, cargo test, rspec, phpunit, and any other invocation that runs the project test suite. Verify your work with typecheck + lint only. The merge gate lives in .github/workflows/test.yml.';

export async function up(knex: Knex): Promise<void> {
    // Scoped to the seeded row by id, and only while it still carries the
    // original text — an Owner who has already reworded this rule keeps their
    // version rather than having it silently overwritten.
    await knex('guardrail_rules')
        .where({ id: ID })
        .andWhere('rule_text', OLD_RULE)
        .update({ rule_text: NEW_RULE, detail: NEW_DETAIL, updated_at: new Date().toISOString() });
}

export async function down(knex: Knex): Promise<void> {
    await knex('guardrail_rules')
        .where({ id: ID })
        .andWhere('rule_text', NEW_RULE)
        .update({ rule_text: OLD_RULE, detail: OLD_DETAIL, updated_at: new Date().toISOString() });
}
