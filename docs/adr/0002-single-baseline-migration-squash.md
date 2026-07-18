# 0002. Single Baseline Migration Squash

**Date:** 2026-06-03
**Status:** Accepted

## Context

After the Postgres migration (ADR 0001), the `packages/api/src/db/migrations/` directory carried 86+ numbered Knex files. The first ~60 were the original SQLite migrations re-typed for Postgres; the rest were the cut-over migrations themselves plus a dozen schema-evolution files written while the unified `items` table was being shaped (Theme 06 column drops, the `depends_on` relation, the role catalog, the two-persona reviewer columns, and so on).

The history had three problems by 2026-06-03:

- Reading it top-to-bottom no longer told the schema story — the early files built tables that later files dropped, renamed, or partitioned.
- `pnpm -F @atlas/api db:reset` took noticeably longer than necessary running migrations whose end state matched a far simpler shape.
- New contributors trying to understand the data model had to mentally diff 86 files to arrive at the current schema, which is documented narratively in `.agents/data-model.md`.

The squash itself is documented in `.agents/api-surface.md:467-487`: every migration was applied to a clean Postgres DB, the result was dumped via `pg_dump --schema-only --no-owner --no-acl --exclude-table='_knex_migrations*'`, the data-only inserts for the four reference tables (`cli_models`, `roles`, `guardrail_rules`, `settings`) were appended, and the result became `001_baseline.sql`. The wrapper `001_baseline.ts` just loads and executes the SQL.

## Decision

Collapse the entire migration history into a single baseline: `packages/api/src/db/migrations/001_baseline.ts` plus its sibling `001_baseline.sql`. The baseline carries the full schema (tables, indexes, triggers, enums, functions) and reference-data inserts. After the squash, schema changes are **append-only**: new files numbered `002_*.ts`, `003_*.ts`, never edits to the baseline. The baseline is re-dumped only if we deliberately decide to re-squash.

The most recent commit at the time of this ADR — `6ea0a8f chore(api): rebase migrations onto single 001_baseline (cleanup of 070-086)` — is the cleanup that finished the consolidation.

## Consequences

- A fresh `db:reset` runs one migration instead of ~86. Local resets are visibly faster.
- The schema is readable in one file. `001_baseline.sql` is the single source of truth for the shape; `.agents/data-model.md` documents the why.
- Owners who already applied the pre-squash migrations carry orphan rows in `_knex_migrations`. The remediation (`DELETE FROM _knex_migrations WHERE name <> '001_baseline.ts'` then re-run `db:migrate`) is documented in the api-surface doc.
- Migration commit history is no longer self-describing for the pre-squash period. The git log up to 2026-06-03 carries the audit trail; `.agents/data-model.md` carries the design notes.
- Future schema work must obey the append-only rule. Editing `001_baseline.sql` is forbidden — `002_*.ts` is the only way to evolve.
