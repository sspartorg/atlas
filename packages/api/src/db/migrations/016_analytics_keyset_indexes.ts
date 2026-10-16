import type { Knex } from 'knex';

// Indexes for the analytics agent-test filter and three keyset/lookup paths
// that 012 left on a sort or a seq scan. Measured on the analytics e2e seed;
// numbers in the commit message.
//
// - `notTestRun` (analytics-window.ts) and the scorecard's test filter probe
//   "is this item an agent test" once per run. A partial index over the few
//   test items answers it without touching the items heap.
// - Notifications page keyset `(created_at, id) < (…)` ORDER BY created_at
//   DESC, id DESC: the old `(created_at DESC)` index needed an incremental sort
//   on the id tie-break; the two-column index serves the order directly and is
//   a superset of it, so the old one is dropped.
// - Reminders history (cancelled / completed, newest first) had no index at
//   all; this one is exactly its WHERE + ORDER BY.
// - The scorecard looks PR links up by url (`link_kind = 'pull_request'`);
//   the only url index was the (item_id, url) unique, useless without item_id.
// - Per-item status history (Delivery's "reworked after Done" probe, the
//   time-in-status replay): with only the time-ordered status index the
//   planner range-scanned every later status event per shipped item — O(n²),
//   136 ms at 2.4k items. Per item it is an index-only seek (4.5 ms).

const CREATE: Array<[name: string, def: string]> = [
    ['idx_items_is_test', 'public.items (id) WHERE is_test'],
    ['idx_notifications_created_id', 'public.notifications (created_at DESC, id DESC)'],
    [
        'idx_reminders_history',
        `public.reminders (updated_at DESC, id DESC) WHERE status IN ('cancelled', 'completed')`,
    ],
    ['idx_item_external_links_pr_url', `public.item_external_links (url) WHERE link_kind = 'pull_request'`],
    [
        'idx_issue_events_item_status',
        `public.issue_events (item_id, created_at) INCLUDE (from_value, to_value) WHERE field = 'status'`,
    ],
];

// Replaced by idx_notifications_created_id (same leading column and direction).
const DROP: Array<[name: string, def: string]> = [
    ['idx_notifications_created_at', 'public.notifications (created_at DESC)'],
];

export async function up(knex: Knex): Promise<void> {
    for (const [name, def] of CREATE) await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    for (const [name] of DROP) await knex.raw(`DROP INDEX IF EXISTS public.${name}`);
}

export async function down(knex: Knex): Promise<void> {
    for (const [name, def] of DROP) await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    for (const [name] of [...CREATE].reverse()) await knex.raw(`DROP INDEX IF EXISTS public.${name}`);
}
