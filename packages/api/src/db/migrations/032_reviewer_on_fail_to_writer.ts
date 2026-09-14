import type { Knex } from 'knex';

// Reviewer rejection returns the item to its writer, not the Owner.
//
// Every SDLC reviewer's catalog on-fail rule used to be `owner` /
// `waiting_for_info`. `.atlas/handoff.md` renders that rule as the routing
// contract and agents are told to follow it, so a "needs revision" verdict
// parked the item with the Owner even though each reviewer prompt says to
// hand revisions back to the writer. The catalog now routes on-fail to the
// paired writer with status `ready` so the writer is auto-dispatched.
//
// Installed agents copy handoff rules at install time, so this repairs rows
// already in `agent_handoff_rules` — but ONLY rows still equal to the old
// catalog default. A rule the Owner customised (any other target or status)
// is left alone.
//
// `down()` restores the old default on rows that equal the new default; an
// Owner who hand-set exactly writer/ready after `up()` is indistinguishable
// and gets reverted too.

const REVIEWER_WRITER_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['agent-po-reviewer', 'agent-po-writer'],
    ['agent-architect-reviewer', 'agent-architect'],
    ['agent-code-reviewer', 'agent-coder'],
    ['agent-qa-reviewer', 'agent-qa-writer'],
    ['agent-automation-reviewer', 'agent-automation'],
];

export async function up(knex: Knex): Promise<void> {
    for (const [reviewer, writer] of REVIEWER_WRITER_PAIRS) {
        await knex.raw(
            `UPDATE agent_handoff_rules
                SET target_agent_id = ?, status = 'ready'
              WHERE agent_id = ?
                AND kind = 'on-fail'
                AND target_agent_id = 'owner'
                AND status = 'waiting_for_info'`,
            [writer, reviewer],
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    for (const [reviewer, writer] of REVIEWER_WRITER_PAIRS) {
        await knex.raw(
            `UPDATE agent_handoff_rules
                SET target_agent_id = 'owner', status = 'waiting_for_info'
              WHERE agent_id = ?
                AND kind = 'on-fail'
                AND target_agent_id = ?
                AND status = 'ready'`,
            [reviewer, writer],
        );
    }
}
