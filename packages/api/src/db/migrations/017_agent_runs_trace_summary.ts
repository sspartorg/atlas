import type { Knex } from 'knex';

// What the agent did, not just what it said it did.
//
// `agent_runs.output_text` has held the full stream-json of every dispatch
// since the runner shipped — every tool call, every turn, every file touched —
// and nothing server-side has ever read it. So an agent test could assert only
// against the `atlas-outcome` block, which is the one part of a run the agent
// authors about itself.
//
// `run-trace-parser.ts` reads that transcript once, at completion, into this
// column. Not computed on read: `output_text` is routinely multiple megabytes
// and the Tests tab polls every five seconds, which is how a poll becomes a
// table scan. Not its own table either — nothing queries an individual tool
// call, and every consumer wants the whole summary for one run.
//
// **No backfill.** Reparsing every historical transcript is minutes of blocking
// multi-megabyte I/O inside a migration, to answer questions about runs nobody
// is asking about. `null` means "this ran before we measured it", and every
// consumer has to render it as "—" rather than as zero — the same distinction
// the column itself draws between a CLI that cannot report a field and a run
// where the thing did not happen.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS trace_summary jsonb`);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE agent_runs DROP COLUMN IF EXISTS trace_summary`);
}
