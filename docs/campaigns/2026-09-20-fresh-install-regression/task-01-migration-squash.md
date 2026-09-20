# 01 — Squash 45 migrations into one fresh baseline

**Status:** done — 2026-09-20
**Depends on:** nothing
**Scope:** api

## Why

`packages/api/src/db/migrations/` holds `001_baseline.{ts,sql}` plus 45 files
through `045_repos_without_primary.ts`. ADR 0002 made exactly this argument at
86 files on 2026-06-03: the history stops telling the schema story once later
files drop what earlier ones built, and a new contributor has to mentally diff
the lot to arrive at the current shape.

It is true again. Migration 045 alone drops seven columns from `projects` that
earlier migrations added. The Owner wants the product to look first-shipped
(ruling D-7), and a single baseline is what that means.

**This runs before the reset** — task-02 purges the volume, and a fresh boot
must build its schema from the new baseline, not from the old chain.

## What to do

1. **Capture the target schema.** Create a scratch database and apply the
   existing 45 migrations to it:
   ```
   docker exec atlas-postgres createdb -U atlas atlas_squash
   DATABASE_URL=postgres://atlas:atlas@localhost:5500/atlas_squash \
     pnpm -F @atlas/api exec tsx src/db/run-migrations.ts latest
   ```
   Confirm `run-migrations.ts status` reports 45 applied before dumping.

2. **Dump the schema**, using the recipe recorded in the current
   `001_baseline.ts` header:
   ```
   pg_dump --schema-only --no-owner --no-acl \
           --exclude-table='_knex_migrations*' atlas_squash
   ```
   Strip the two psql meta commands (`\restrict` / `\unrestrict`).

3. **Re-append the reference data by hand.** `--schema-only` does not emit it,
   and a baseline without it produces an unusable install. The current
   `001_baseline.sql` carries **36 `INSERT` statements** across four tables —
   16 `cli_models`, 14 `guardrail_rules`, 5 `roles`, and the singleton
   `INSERT INTO public.settings (id) VALUES (1)`. Regenerate them with
   `--column-inserts` restricted to those four tables, or carry the existing
   block forward and reconcile it against the scratch DB's actual rows.

   ⚠️ The count is **not** still 16 `cli_models` — `029_ollama_cli.ts` inserts
   five more. Dump from the scratch DB, do not copy the old block blind.

4. **Write the new baseline.** Replace `001_baseline.sql` with the dump, keep
   `001_baseline.ts` as the thin loader it already is, and keep its `down()` a
   documented no-op. Update its header comment to say it was squashed from
   001–045 on the execution date, and carry the regeneration recipe forward.

5. **Delete `002_*.ts` through `045_*.ts`** — 44 files.

6. **Fix the tests the squash breaks.**
   - `packages/api/src/db/migrations-rollback.test.ts` asserts
     `migrations.length >= 18` and contiguous numbering from 1. A single
     baseline fails the first assertion immediately. Relax it to `>= 1` and
     keep the contiguity check — the append-only rule still needs guarding.
   - `packages/api/src/db/migrations.test.ts` asserts
     `rows[0].name === '001_baseline.ts'` (still true — do not rename) and
     `>= 33` public tables (43 today, still true).
   - ⚠️ **This step's prediction was wrong.** The task assumed all eight
     migration-named specs assert the live schema and would pass unchanged.
     **Six of them import `up`/`down` from the migration module itself** and
     died at import: `catalog-sync` (034), `tasks` (037), `graphs-vertical`
     (039), `published-workflows` (041), `jira-sources` (044),
     `repos-without-primary` (045). They test transitions that no longer exist
     as discrete steps, so they were **deleted** and removed from the
     `include:` allowlist. `workflows-migration.test.ts` (035) and
     `hot-path-indexes.test.ts` (021) survived — they assert the schema, not
     the migration. That is the rule for any future squash.

7. **Prove the baseline reproduces the schema.** Apply the new single baseline
   to a second scratch DB and diff the two dumps:
   ```
   docker exec atlas-postgres createdb -U atlas atlas_squash_verify
   DATABASE_URL=…/atlas_squash_verify pnpm -F @atlas/api exec tsx src/db/run-migrations.ts latest
   pg_dump --schema-only --no-owner --no-acl --exclude-table='_knex_migrations*' atlas_squash_verify > /tmp/after.sql
   diff /tmp/before.sql /tmp/after.sql
   ```
   The diff must be empty. Also compare row counts in `cli_models`, `roles`,
   `guardrail_rules` and `settings` between the two.

8. **Drop both scratch DBs.**

9. **Write ADR 0019** from `docs/adr/_template.md`, superseding ADR 0002.
   Record: why a second squash, the 36-INSERT trap, the relaxed rollback-test
   assertion, and that `002_*.ts` is again the only way to evolve. Add its row
   to `docs/adr/README.md` in the same commit. Mark ADR 0002 as superseded.

10. **Update `.agents/api-surface.md`** migrations index — the self-update rule
    lists "a migration added" as a trigger, and deleting 44 counts.

## Done when

- [x] `ls packages/api/src/db/migrations/` lists exactly `001_baseline.ts` and
      `001_baseline.sql`
- [x] The before/after `pg_dump` diff is empty
- [x] Reference data matches — a full `--column-inserts` dump of all four
      tables diffs clean, 39 rows, stronger than a count comparison
- [x] `pnpm -F @atlas/api test` is green
- [x] `migrations-rollback.test.ts` passes with the relaxed assertion; the
      contiguity check is untouched
- [x] Resolved differently than planned — see the ⚠️ note in step 6. Two
      survive and pass; six were deleted as tests of deleted code
- [x] `atlas_squash` and `atlas_squash_verify` no longer exist
- [x] `docs/adr/0019-second-baseline-squash.md` exists, ADR 0002 is marked
      superseded, and `docs/adr/README.md` has the row — **plus a row for 0018,
      which had been written on 2026-09-20 and never indexed**
- [x] `.agents/api-surface.md` migrations section rewritten to one baseline,
      with corrected reference-data counts and the verification rule

## Evidence

Executed 2026-09-20.

**Schema equivalence.** All 45 migrations applied to `atlas_squash`; the new
single baseline applied via `run-migrations.ts latest` to
`atlas_squash_verify`. Both dumped with
`pg_dump --schema-only --no-owner --no-acl --exclude-table='_knex_migrations*'`:

```
=== SCHEMA DIFF (empty = identical) ===
IDENTICAL
=== DATA DIFF ===
IDENTICAL — 39 rows
=== knex ledger in verify DB ===
001_baseline.ts|1
```

Object counts, confirming the only delta is knex's own bookkeeping:

```
atlas_squash         tables=45 indexes=127 fks=46
atlas_squash_verify  tables=43 indexes=125 fks=46
```

45 − 43 = `_knex_migrations` + `_knex_migrations_lock`, which the dump excludes.

**Reference data.** 39 rows, not the 36 the task predicted:
`cli_models` 19 (not 16 — `029_ollama_cli.ts` added three), `guardrail_rules`
14, `roles` 5, `settings` 1. `.agents/api-surface.md` had claimed
`guardrail_rules` (23 rows) and `cli_models` (16 rows); both were stale and are
corrected.

**Test suite.**

```
 Test Files  152 passed (152)
      Tests  2622 passed (2622)
   Duration  309.51s
```

### Two traps hit, both recorded in the loader header and ADR 0019

1. **`\restrict` / `\unrestrict` survived into the baseline.** Both dump
   passes emit them; I stripped them only from the schema pass. The first
   verification used `psql -f`, which treats them as meta-commands and
   swallows them — so verification passed while knex failed with
   `syntax error at or near "\"`. Caught by `pnpm -F @atlas/api test`, not by
   my own check.

2. **`SELECT pg_catalog.set_config('search_path', '', false)` survived.** It
   blanks the search path for the session, after which knex's own
   `insert into "_knex_migrations"` failed with
   `relation "_knex_migrations" does not exist`. The previous squash had
   stripped the whole `SET` preamble; I had not.

⚠️ **Both traps were already documented** in `.agents/api-surface.md`'s
"Regenerating the baseline" paragraph. I read `001_baseline.ts`'s header
instead, which did not carry them. The recipe now lives in **both** places, and
the verification rule is explicit: run the candidate baseline through
`run-migrations.ts` and diff, never `psql -f`. This is the `.agents/` cache
doing its job and being bypassed — the lesson AGENTS.md states in its opening
paragraph about not re-exploring what the docs already record.

**Deviation from plan.** The task predicted eight migration-named specs would
pass unchanged. Six failed at import because they import the migration module.
They were deleted rather than rewritten: each asserts a transition the squash
dissolves. 706 lines of test removed; test count unchanged at 2622 because
those files failed at import and never contributed passing tests.
