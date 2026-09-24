import type { Knex } from 'knex';

// Agent tests become product data (ADR 0023).
//
// Atlas ships a fleet of agents and lets customers install more, edit them and
// write their own, and has no way for anyone to find out whether one works. The
// measurement that exists is `evals/` — fixtures in the repo, a CLI runner, a
// CLI scorer, a markdown file. All of it ours and local, none of it something a
// customer can reach. So an agent is installed on trust, and an agent someone
// writes themselves cannot be qualified at all.
//
// **Why a test owns an item template rather than a prompt.** The `Test Run` tab
// has fired an ad-hoc prompt at an agent since the beginning and has never been
// usable as a test, and the reason is structural: PO Writer refuses anything
// that is not a Task (its kind guard), Coder needs a sub-task with a repo and a
// spec, Release Reviewer needs a whole branch. A bare prompt cannot exercise
// any of them. A test therefore carries the item it wants the agent to act on —
// which is exactly what a golden fixture already is, and why these are one
// primitive rather than two features.
//
// **Why the item is created per run.** A test that points at a live item gives
// a different answer every time the repo moves under it, which makes it useless
// as a regression check. Each run materialises a throwaway item from the
// template, and `item_id` records which one, so a failure can be opened and
// read rather than guessed at.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE agent_tests (
            id text PRIMARY KEY,
            agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            -- Which repo the agent works in. Nullable: an agent that touches no
            -- repo (a reviewer reading an item) still deserves a test.
            repo_id text REFERENCES project_repos(id) ON DELETE SET NULL,
            name text NOT NULL,
            -- { issue_type, title, description, acceptance_criteria, labels }
            item_template jsonb NOT NULL,
            -- { outcome_kind?, required_checklist_all_passed?, summary_contains?,
            --   summary_omits?, max_cost_usd?, max_duration_s? }
            expectations jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await knex.raw(`CREATE INDEX agent_tests_agent_idx ON agent_tests (agent_id, created_at DESC)`);

    await knex.raw(`
        CREATE TABLE agent_test_runs (
            id text PRIMARY KEY,
            agent_test_id text NOT NULL REFERENCES agent_tests(id) ON DELETE CASCADE,
            -- The dispatch this test is judging. Nullable only between creating
            -- the row and the spawn returning.
            agent_run_id text REFERENCES agent_runs(id) ON DELETE SET NULL,
            -- The throwaway item the agent acted on, kept so a failure is
            -- readable rather than a mystery.
            item_id text REFERENCES items(id) ON DELETE SET NULL,
            verdict text NOT NULL DEFAULT 'running',
            -- Every expectation that did not hold, in the order they are
            -- declared. Empty on a pass.
            failures jsonb NOT NULL DEFAULT '[]'::jsonb,
            cost_usd numeric(12, 6),
            duration_s integer,
            created_at timestamptz NOT NULL DEFAULT now(),
            evaluated_at timestamptz,
            CONSTRAINT agent_test_runs_verdict_check
                CHECK (verdict = ANY (ARRAY['running', 'passed', 'failed', 'errored']))
        )
    `);
    await knex.raw(
        `CREATE INDEX agent_test_runs_test_idx ON agent_test_runs (agent_test_id, created_at DESC)`,
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS agent_test_runs`);
    await knex.raw(`DROP TABLE IF EXISTS agent_tests`);
}
