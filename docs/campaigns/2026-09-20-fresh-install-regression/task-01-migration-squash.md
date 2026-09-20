# 01 — Squash 45 migrations into one fresh baseline

**Status:** todo
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
   - Eight migration-named test files assert against the **live schema**, not
     against the migration file, so they should pass unchanged. Run each and
     confirm: `catalog-sync-migration.test.ts`, `workflows-migration.test.ts`,
     `tasks-migration.test.ts`, `graphs-vertical-migration.test.ts`,
     `published-workflows-migration.test.ts`, `jira-sources-migration.test.ts`,
     `repos-without-primary-migration.test.ts`, `hot-path-indexes.test.ts`.
     Any that fails is asserting on a migration artifact rather than on the
     schema — fix the test, not the baseline.

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

- [ ] `ls packages/api/src/db/migrations/` lists exactly `001_baseline.ts` and
      `001_baseline.sql`
- [ ] The before/after `pg_dump` diff is empty — paste the `diff` invocation
      and its (empty) output
- [ ] Reference-data row counts match between old-chain and new-baseline
      databases — paste the four `SELECT count(*)` results side by side
- [ ] `pnpm -F @atlas/api test` is green — paste the tail
- [ ] `migrations-rollback.test.ts` passes with the relaxed assertion, and the
      contiguity check is still present (show the diff of that file)
- [ ] All eight migration-named test files pass, named individually
- [ ] `atlas_squash` and `atlas_squash_verify` no longer exist
- [ ] `docs/adr/0019-*.md` exists, ADR 0002 is marked superseded, and
      `docs/adr/README.md` has the new row
- [ ] `.agents/api-surface.md` migrations index reflects one baseline

## Evidence

*(filled during execution)*
