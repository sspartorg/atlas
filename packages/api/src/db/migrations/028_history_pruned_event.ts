import type { Knex } from 'knex';

// Add `history_pruned` to the issue_events.event_type CHECK constraint
// so the historyPruneService can write an audit-trail row after it hard-
// deletes comments + events for an item. Without a dedicated event type,
// the very audit surface that would record the destructive operation is
// what the prune removes — there is no way to reconstruct who/when/how-
// many rows were removed after the fact.
//
// The bulk-delete audit event is written AFTER the transaction commits
// so its own created_at is later than the cutoff and it cannot be pruned
// by the same call. See historyPruneService.pruneBefore for the shape:
//   { event_type: 'history_pruned', actor_agent_id: <caller>, field: null,
//     from_value: <cutoff ISO timestamp>, to_value: <comments+events
//     deleted count>, detail: '<preserved-owner-count> owner comment(s)
//     preserved' }.

export async function up(knex: Knex): Promise<void> {
    // Postgres doesn't support ALTER CONSTRAINT for CHECK — drop + re-add
    // with the extended allow-list. The DROP...IF EXISTS variant is safe
    // if a prior partial migration left the constraint absent.
    await knex.schema.raw(`
        ALTER TABLE public.issue_events
            DROP CONSTRAINT IF EXISTS issue_events_event_type_check;
        ALTER TABLE public.issue_events
            ADD CONSTRAINT issue_events_event_type_check
            CHECK (event_type = ANY (ARRAY[
                'created'::text,
                'status_changed'::text,
                'assigned'::text,
                'field_updated'::text,
                'unblocked'::text,
                'comment_added'::text,
                'link_created'::text,
                'link_deleted'::text,
                'rounds_reset'::text,
                'dispatch_blocked'::text,
                'deleted'::text,
                'history_pruned'::text
            ]));
    `);
}

export async function down(knex: Knex): Promise<void> {
    // Delete any rows carrying the new event_type before shrinking the
    // constraint, or the ALTER would fail on live data written under
    // the extended version.
    await knex.schema.raw(`
        DELETE FROM public.issue_events WHERE event_type = 'history_pruned';
        ALTER TABLE public.issue_events
            DROP CONSTRAINT IF EXISTS issue_events_event_type_check;
        ALTER TABLE public.issue_events
            ADD CONSTRAINT issue_events_event_type_check
            CHECK (event_type = ANY (ARRAY[
                'created'::text,
                'status_changed'::text,
                'assigned'::text,
                'field_updated'::text,
                'unblocked'::text,
                'comment_added'::text,
                'link_created'::text,
                'link_deleted'::text,
                'rounds_reset'::text,
                'dispatch_blocked'::text,
                'deleted'::text
            ]));
    `);
}
