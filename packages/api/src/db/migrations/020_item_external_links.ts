import type { Knex } from 'knex';

// PR external-links — first-class link rows for off-platform artifacts
// (currently scoped to pull_request URLs only).
//
// Before this migration, `items.pr_url` held a single scalar URL that was
// overwritten on every successful PR-raising run, so older PRs against the
// same item became invisible from the UI. This table stores every PR URL
// ever attached to an item — by the orchestrator (after `openPullRequest`
// completes) or by the user via the new "Add PR link" UI.
//
// link_kind is a CHECK constraint, not an enum type. Adding new kinds (e.g.
// 'ci_run', 'design_doc') later means relaxing the CHECK, not a DDL type
// migration that requires data rewrites.
//
// UNIQUE (item_id, url) makes service-layer create() idempotent — re-running
// the orchestrator on the same branch (which hits the "PR already exists"
// branch of `openPullRequest`) won't create duplicate rows.
//
// Backfill: copies non-null `items.pr_url` values into the new table once.
// `external_ref` (PR number) is parsed from the URL via a regex CTE so the
// JS service can show '#123' without re-parsing on every render.
//
// We deliberately do NOT drop `items.pr_url` here; the column stays in the
// schema as inert data so old activity rows (which reference the field name
// via ActivityCard's FIELD_LABELS map) still resolve. A future migration
// can drop it once all readers are removed.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.item_external_links (
            id                bigserial PRIMARY KEY,
            item_id           text NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
            link_kind         text NOT NULL,
            url               text NOT NULL,
            title             text,
            external_ref      text,
            created_at        timestamptz NOT NULL DEFAULT now(),
            created_by_run_id text REFERENCES public.agent_runs(id) ON DELETE SET NULL,
            CONSTRAINT item_external_links_link_kind_check
                CHECK (link_kind IN ('pull_request')),
            CONSTRAINT item_external_links_item_url_unique
                UNIQUE (item_id, url)
        );

        CREATE INDEX idx_item_external_links_item_id
            ON public.item_external_links (item_id);

        INSERT INTO public.item_external_links (item_id, link_kind, url, external_ref)
        SELECT
            id,
            'pull_request',
            pr_url,
            substring(pr_url FROM 'https?://github\\.com/[^/]+/[^/]+/pull/(\\d+)')
        FROM public.items
        WHERE pr_url IS NOT NULL
          AND pr_url <> '';
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.idx_item_external_links_item_id;
        DROP TABLE IF EXISTS public.item_external_links;
    `);
}
