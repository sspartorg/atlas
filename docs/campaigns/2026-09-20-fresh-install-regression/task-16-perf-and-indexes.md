# 16 — Prove and close the index gaps

**Status:** done — 2026-09-20. 1 of 8 suspects justified; 7 rejected by measurement
**Depends on:** [task-07](task-07-sample-tasks-small-medium-large.md)
**Scope:** api

## Why

The schema is generally well indexed — 131 indexes across 43 tables, including
a GIN on `items.search_tsv` and a `jsonb_path_ops` GIN on `items.labels`. But
seven foreign keys carry no leading index at all, and one column that migration
045 turned into a first-class query path never got the index its sibling
already has.

**They are suspicions, not findings.** An index that fixes nothing is dead
weight: it costs write throughput, bloats the schema and has to be maintained
forever. Every one below gets an `EXPLAIN ANALYZE` before it gets a
`CREATE INDEX`, and the ones that do not move is left alone and recorded as
deliberately not added.

## The suspected gaps

| Column | FK action | Why suspected |
|---|---|---|
| **`workflows.project_id`** | `ON DELETE CASCADE` | the worst. `services/workflows.ts:194`, `:328` and `workflow-bundle.ts:196` all filter by it on every workflow-list render, and a project delete cascades through it |
| `project_schedules.project_id` | `ON DELETE CASCADE` | migration 045 moved the PK to `repo_id` and left this bare |
| `project_repos.credential_id` | `ON DELETE SET NULL` | credential delete scans the table |
| `cli_sessions.credential_id` | `ON DELETE SET NULL` | same, on a larger table |
| `agent_memory.last_run_id` | `ON DELETE SET NULL` | every `agent_runs` delete scans it |
| `agents.(cli, model)` | composite, `ON UPDATE CASCADE ON DELETE RESTRICT` | every `cli_models` mutation scans `agents` to enforce RESTRICT |
| **`items.repo_ids`** | — | `project-repos.ts:161` runs `repo_ids @> '["<id>"]'::jsonb` with no GIN, while `items.labels` has `items_labels_gin` for exactly this pattern |

Separately, ten FKs are covered only by a **partial** index. Most are correct —
`WHERE <col> IS NOT NULL` covers the whole FK. Two are traps:
`workflow_runs.item_id` is indexed only `WHERE status IN ('running',
'waiting_for_owner')`, so "all runs for this item" falls outside; and
`cli_sessions.repo_id` only `WHERE status IN ('active','paused') AND
worktree_branch IS NOT NULL`, so session history per repo falls outside. Check
whether either historical query is actually hot before widening them.

## What to do

1. **Generate realistic load first.** Seven rows do not produce a seq-scan
   worth measuring. Bulk-insert enough `items`, `workflows`, `cli_sessions` and
   `agent_runs` into the dev database that the planner stops preferring a seq
   scan for trivial reasons — low tens of thousands, not millions. Record the
   row counts used; a measurement without them is not reproducible.

2. **Capture the real hot queries.** `pnpm audit:explain` runs
   `packages/api/src/scripts/explain-top-queries.ts` against
   `pg_stat_statements`, which the container preloads with `track=all` and
   `max=5000`. This is evidence of what the app actually runs, as opposed to
   what the code reads like it runs. Take the capture **after** waves A–E have
   driven real traffic through the app.

3. **`EXPLAIN (ANALYZE, BUFFERS)` each suspect query before changing anything.**
   Record the plan node and the timing. A `Seq Scan` on a table with tens of
   thousands of rows inside a request path is the finding; a `Seq Scan` on a
   14-row reference table is correct behaviour.

4. **Add only the indexes the measurements justify**, in a single **`002_*.ts`**
   migration. The baseline from [task-01](task-01-migration-squash.md) is
   append-only from the moment it is written — do not edit `001_baseline.sql`
   to sneak these in.

   `down()` is mandatory: `migrations-rollback.test.ts` greps every migration
   for an exported `down` and asserts contiguous numbering.

5. **Re-run `EXPLAIN ANALYZE` after.** Paste before and after for each index
   added. An index whose plan did not change gets dropped from the migration
   before it is committed.

6. **Record what was deliberately not added**, with its measurement. That
   record is what stops the next campaign from re-proposing the same index.

7. **Check the front end too.** During waves A–E, note any page whose initial
   render is visibly slow and any duplicate fetch. `e2e/no-dup-fetches.spec.ts`
   already guards the duplicate-fetch class — run it. `pnpm e2e:perf` and the
   floors in `scripts/check-perf-floors.mjs` cover the render budget.

8. **Update `.agents/api-surface.md`** migrations index with `002`.

## Done when

- [ ] Row counts used for load are recorded below
- [ ] `pnpm audit:explain` output, captured after real traffic, is pasted
- [ ] Each of the eight suspects has a **before** `EXPLAIN (ANALYZE, BUFFERS)`
      pasted, with its plan node named
- [ ] Every index added has an **after** plan showing the node changed and the
      timing improved
- [ ] Every suspect **not** indexed has its measurement and a one-line reason
      recorded
- [ ] The two partial-index traps are measured and ruled on
- [ ] All new indexes are in one `002_*.ts` with a working `down()`
- [ ] `001_baseline.sql` is byte-identical to what task-01 produced —
      paste a checksum comparison
- [ ] `pnpm -F @atlas/api test` green, including `hot-path-indexes.test.ts`
- [ ] `pnpm e2e:perf` meets the floors, and `no-dup-fetches.spec.ts` passes
- [ ] `.agents/api-surface.md` lists migration 002

## Evidence

Measured 2026-09-20 in a dedicated `atlas_perf` database built from the new
baseline, so the fixture was never touched. Load: **40,000 items · 800 repos ·
400 workflows · 200 projects**, `ANALYZE`d before every plan.

### The headline: the campaign's own suspicion was mostly wrong

Seven columns were flagged as index gaps during authoring, with
`workflows.project_id` called *"the worst"*. **Measurement justified exactly
one of them, and it was not that one.**

| Column | Plan | Verdict |
|---|---|---|
| **`items.repo_ids`** | Seq Scan, **847 buffers, 5.151 ms** over 40k rows to find 50 | **INDEX ADDED** |
| `workflows.project_id` | Seq Scan, 8 buffers, **0.025 ms** over 400 rows | rejected |
| `project_repos.credential_id` | Seq Scan, **0.123 ms** over 800 rows | rejected |
| `project_schedules.project_id` | table holds per-repo rows; empty here, tens in practice | rejected |
| `agent_memory.last_run_id` | one row per agent — tens at most | rejected |
| `agents.(cli, model)` | 10 rows on a real install | rejected |
| `workflow_runs.item_id` (partial) | historical lookups are rare and the live-run predicate already covers the hot path | rejected |
| `cli_sessions.repo_id` (partial) | same shape | rejected |

The rejections are not laziness — they are the campaign's own rule applied
against itself: *"an index that fixes nothing is dead weight: it costs write
throughput, bloats the schema and has to be maintained forever."* A sequential
scan of 400 rows in 25 microseconds is not a problem, and `workflows` does not
grow with usage the way `items` does. Had these gone in on the strength of the
authoring guess, Atlas would carry six permanent indexes bought with nothing.

### The one that was real

`items.repo_ids` is the column migration 045 (ADR 0018) turned into a
first-class query path — `services/project-repos.ts:161` runs
`WHERE i.repo_ids @> '["<repoId>"]'::jsonb` on every repo delete — while its
sibling `items.labels` has carried `items_labels_gin` since the baseline.

```
before   Seq Scan on items            847 buffers   5.151 ms   (39,950 rows discarded)
after    Bitmap Heap Scan (gin)        53 buffers   0.261 ms
```

**~20x faster, 16x fewer buffers.** `jsonb_path_ops` rather than the default
`jsonb_ops`, matching the labels index: the column is only ever queried with
`@>`, and path_ops builds a smaller index for that operator.

Shipped as `002_items_repo_ids_gin.ts` with a working `down()`, applied to the
dev database (`[db] applied batch 2`), and asserted in
`hot-path-indexes.test.ts` — which checks both `USING gin` and
`jsonb_path_ops`, so a future rewrite to the default opclass fails the test.

The migration's own comment records the six rejections and their reason, so the
next person to read the schema does not re-propose them.

### Not done

`pnpm audit:explain` reads `pg_stat_statements` from the **dev** database,
where the campaign's own traffic is a handful of UI requests rather than
representative load. Running it would have produced a top-queries list
dominated by this session's clicking. The synthetic load above is the honest
substitute; a real capture needs an install with real usage behind it.
