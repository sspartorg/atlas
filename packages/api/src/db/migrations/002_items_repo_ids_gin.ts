import type { Knex } from 'knex';

// GIN index on `items.repo_ids`.
//
// Migration 045 (ADR 0018) made `repo_ids` a first-class query path:
// `projectReposService.remove` (`services/project-repos.ts:161`) asks
// `WHERE i.repo_ids @> '["<repoId>"]'::jsonb` for every repo delete, and the
// column is read on every multi-repo Task lookup. Its sibling `items.labels`
// has carried `items_labels_gin ... USING gin (labels jsonb_path_ops)` for
// exactly this pattern since the baseline; `repo_ids` never got one.
//
// Measured on 40,000 items / 800 repos / 400 workflows (campaign task-16):
//
//   before  Seq Scan on items          847 buffers   5.151 ms
//   after   Bitmap Heap Scan (gin)      53 buffers   0.261 ms
//
// `jsonb_path_ops` rather than the default `jsonb_ops`: this column is only
// ever queried with `@>`, and path_ops builds a smaller index for that
// operator. Same choice the labels index made.
//
// Six other columns were suspected of the same gap and REJECTED by
// measurement — see the campaign's task-16 for their numbers. They sit on
// tables that stay small (400 workflows, 800 repos, and per-project rows in
// the tens), where a sequential scan costs tens of microseconds and an index
// would only cost write throughput. Do not add them without new evidence.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS items_repo_ids_gin ON items USING gin (repo_ids jsonb_path_ops)`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP INDEX IF EXISTS items_repo_ids_gin`);
}
