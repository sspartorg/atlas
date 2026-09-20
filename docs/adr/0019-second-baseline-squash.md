# 0019. Second Baseline Squash

**Date:** 2026-09-20
**Status:** Accepted. Supersedes [ADR 0002](0002-single-baseline-migration-squash.md).

## Context

ADR 0002 collapsed 86 Knex files into `001_baseline.{ts,sql}` on 2026-06-03 and made schema changes append-only from that point. Three and a half months later the directory held the baseline plus 45 deltas, and the three problems ADR 0002 named had all returned.

Reading the history top-to-bottom no longer told the schema story. `045_repos_without_primary.ts` drops seven columns from `projects` that earlier migrations added, re-keys `project_schedules` from `project_id` to `repo_id`, and backfills `items.repo_ids` — so a reader arriving at the current shape has to mentally replay 45 files to work out that a project no longer has git fields at all. Several migrations are data, not schema: `031_backfill_agent_comment_attribution.ts` is a pure data repair whose `down()` is an explicit no-op, and `032`, `034`, `037` and `045` mix backfills into their DDL. Those backfills operate on rows a fresh install does not have.

The forcing function was the 2026-09-20 fresh-install campaign, which wipes the Docker volume and boots Atlas from nothing to prove a new adopter's first run works. A fresh install running 45 migrations to reach a state one file could describe is exactly the waste ADR 0002 removed once already.

The alternative considered and rejected was leaving the files alone: a purged volume already produces a schema-identical database, so the squash buys readability rather than correctness. It was rejected because readability of the data model is the stated reason ADR 0002 exists, and the campaign's own premise is that the product should look first-shipped.

## Decision

Regenerate `001_baseline.{ts,sql}` from migrations 001–045 applied to a clean database, delete `002_*.ts` through `045_*.ts`, and keep the append-only rule: the next schema change is `002_*.ts`. The baseline keeps its name and its no-op `down()`.

The regeneration is two `pg_dump` passes, not one. `--schema-only` emits no rows, and the baseline carries 39 reference-data rows — 19 `cli_models`, 14 `guardrail_rules`, 5 `roles` and the `settings` singleton — without which an install has no CLI models to pick, no guard-rails and no settings row to onboard into. The `cli_models` count had grown from 16 to 19 since the previous squash (`029_ollama_cli.ts`), so the old INSERT block could not be carried forward unread. The full recipe, including the two failure modes below, is recorded in the `001_baseline.ts` header.

## Consequences

- A fresh `db:reset` runs one migration instead of 46. The schema is readable in one file again.
- **Six migration test files were deleted**: `catalog-sync-migration.test.ts` (034), `tasks-migration.test.ts` (037), `graphs-vertical-migration.test.ts` (039), `published-workflows-migration.test.ts` (041), `jira-sources-migration.test.ts` (044) and `repos-without-primary-migration.test.ts` (045). Each imported `up`/`down` from the migration file it named, so it tested a transition that no longer exists as a discrete step — the baseline is that transition's end state. `workflows-migration.test.ts` (035) and `hot-path-indexes.test.ts` (021) survive because they assert the live schema rather than the migration. That distinction is the rule for any future squash.
- `migrations-rollback.test.ts`'s floor of "at least 18 numbered migration files" was relaxed to "at least the baseline". The contiguity check it sits beside is what actually guards the append-only rule; the floor only ever caught an empty directory.
- **Two dump artifacts must be stripped from the combined output, and `psql` hides both.** `\restrict` / `\unrestrict` lines are emitted by both passes; psql treats them as meta-commands and swallows them, so verifying with `psql -f` passes while knex dies with `syntax error at or near "\"`. Worse, the preamble's `SELECT pg_catalog.set_config('search_path', '', false)` blanks the search path for the rest of the session, after which knex's own `insert into "_knex_migrations"` fails with `relation "_knex_migrations" does not exist`. Both were hit during this squash. A regenerated baseline is verified by running it through `run-migrations.ts` against a second clean database and diffing the dumps — never by `psql -f`.
- Per-delta rollback is gone again. `001_baseline.down()` is a no-op, so rollback means purging the volume. This is acceptable for a single-owner local product and unacceptable for a hosted one; if Atlas ever ships hosted, this ADR is the one to revisit.
- Any database still carrying the pre-squash `_knex_migrations` rows breaks: Knex finds 45 completed entries whose files are gone and refuses with a corrupt-directory error. The remediation is to drop and recreate the database, which is what the campaign does to `atlas_test` and what `db:down:purge` does to the dev volume. `atlas_e2e` self-heals because `e2e/global-setup.ts` drops it every run.
- The pre-squash audit trail lives in git history up to 2026-09-20; `.agents/data-model.md` carries the design notes.
