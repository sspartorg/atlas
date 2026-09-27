# 0025. Third Baseline Squash and Catalog v1

**Date:** 2026-09-28
**Status:** Accepted. Supersedes [ADR 0019](0019-second-baseline-squash.md).

## Context

Eight days after ADR 0019, the migrations directory held the baseline plus 23 deltas (002–024). Several were data rather than schema (004 Claude 5 models, 005 guard-rail wording, 006 catalog clamp, 012 SDLC roles, 015 verdict backfill), and they only acted on rows a fresh install does not have. Over the same stretch the marketplace catalog drifted back up from the 2026-09-22 v1 reset: the 28 agents sat at versions 2–6, and the `delivery` workflow template was at 5. The Owner wants a release to start from one baseline and v1 everywhere.

## Decision

- Regenerate `001_baseline.{ts,sql}` from 001–024 applied to a clean database using the ADR 0019 recipe, and delete `002_*.ts` through `024_*.ts`. The next schema change is `002_*.ts`.
- Set `version: 1` in every `catalog/*/manifest.json` and every workflow template, and regenerate `catalog.lock.json`. Bundle hashes exclude the version, so only the versions change.
- Add no clamp migration of the kind 006 was. The squash already requires every existing DB to reset or clean up by hand, so the clamp goes in the cleanup SQL (`.agents/api-surface.md` §"Existing-DB cleanup").

## Consequences

- The baseline now carries 48 reference rows: 23 `cli_models`, 14 `guardrail_rules`, 10 `roles`, 1 `settings`. It was verified by running it through `run-migrations.ts` on a second clean DB and diffing the full dump against the 24-migration DB, which came out identical.
- `backfill-skipped-verdicts.test.ts` was deleted because it imported from migration 015 (ADR 0019 rule). `seed.test.ts` now asserts the worktree-scoped guard-rail wording that 005 introduced.
- The fleet-intervention series (`agent-scorecard.ts`) was anchored on migration 024's `migration_time`. It now anchors on `001_baseline.ts`. On a fresh install that is install time, which is correct. On a DB that was cleaned up in place, it counts runs from that DB's original install, including runs that predate `workflow_run_events`.
- On an existing DB, the catalog reset is a downgrade. Without the clamp, an agent pulled at v6 is never offered an upgrade again until the catalog passes 6. Resetting the DB avoids this; the in-place cleanup applies the clamp.
