import type { Knex } from 'knex';

// Follow through after the PR: Atlas reads CI and acts on red.
//
// `item_external_links` already carries the PR's lifecycle (`pr_state`,
// refreshed on the scheduler tick with a 5-minute TTL). CI is the other half
// of "is this PR done?", and it hangs off the same row for the same reason:
// it is per PR, not per Task — a multi-repo Task (ADR 0017) has one PR per
// repo and each has its own checks.
//
//   `ci_state`        — combined check-runs + legacy statuses for the PR's head
//                       commit. NULL means "no CI observed", which is NOT the
//                       same as success: a repo with no CI gets no chip.
//   `ci_head_sha`     — the commit that state belongs to. A new push resets it.
//   `ci_summary`      — the failing checks, `[{name, detail}]`, so the comment,
//                       the notification and the chip tooltip all quote the
//                       same evidence without a second GitHub round-trip.
//   `ci_checked_at`   — when it was last read.
//
// Two bookkeeping columns keep the automatic fix honest rather than a loop:
//
//   `ci_handled_sha`  — the head commit Atlas last acted on. Acting is once per
//                       commit: the tick re-reads a red PR every 5 minutes and
//                       must not comment, notify and restart every time.
//   `ci_fix_attempts` — automatic fix runs started for this PR. The Task-level
//                       cap (2) is the SUM over its PRs; a column beats deriving
//                       it from issue_events, whose event_type CHECK would need
//                       widening and whose rows the Owner can prune.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE item_external_links
            ADD COLUMN IF NOT EXISTS ci_state text
                CHECK (ci_state IN ('pending', 'success', 'failure')),
            ADD COLUMN IF NOT EXISTS ci_head_sha text,
            ADD COLUMN IF NOT EXISTS ci_summary jsonb,
            ADD COLUMN IF NOT EXISTS ci_checked_at timestamptz,
            ADD COLUMN IF NOT EXISTS ci_handled_sha text,
            ADD COLUMN IF NOT EXISTS ci_fix_attempts integer NOT NULL DEFAULT 0
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE item_external_links
            DROP COLUMN IF EXISTS ci_state,
            DROP COLUMN IF EXISTS ci_head_sha,
            DROP COLUMN IF EXISTS ci_summary,
            DROP COLUMN IF EXISTS ci_checked_at,
            DROP COLUMN IF EXISTS ci_handled_sha,
            DROP COLUMN IF EXISTS ci_fix_attempts
    `);
}
