import type { Knex } from 'knex';

// Per-notification deep-link target. Until now `urlForNotification`
// derived the click destination from `item_type` + `item_id` (epic /
// story / etc.) and fell back to `/notifications`. Notifications about
// surfaces with no matching IssueType — Terminal sessions, future
// queue or settings alerts — landed on the fallback. The new optional
// `link_url` lets the caller name the exact target; both the service
// worker (web push) and the in-app feed (InAppFeedTabContent) check
// this first, then fall back to the legacy item-based routing.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.notifications
            ADD COLUMN IF NOT EXISTS link_url text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.notifications DROP COLUMN IF EXISTS link_url;
    `);
}
