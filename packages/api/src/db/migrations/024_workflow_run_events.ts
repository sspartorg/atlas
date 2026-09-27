import type { Knex } from 'knex';

// The history of a run waiting on the Owner.
//
// `workflow_runs.park_reason` holds only the CURRENT wait: every resume path
// nulls it, so by the time a run finishes there is no record that it ever
// stopped to ask. That made "how often does the fleet need me?" unanswerable
// — the Owner interventions per Task on the fleet page — and the only honest
// fix is to write the event down when it happens. Nothing is backfilled,
// because nothing survived to backfill from; the fleet route reports the
// date this migration ran as the start of the series instead.
//
// `item_id` is copied from the run rather than joined through it so a row
// still says which Task it was about after the item is deleted. It is not a
// foreign key for the same reason.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS workflow_run_events (
            id text PRIMARY KEY,
            workflow_run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            item_id text,
            kind text NOT NULL CHECK (kind IN ('parked', 'resumed')),
            node_id text,
            reason text,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS workflow_run_events_run_idx
            ON workflow_run_events (workflow_run_id, created_at)
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS workflow_run_events`);
}
