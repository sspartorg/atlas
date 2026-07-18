# 0004. Unified Items Table with Polymorphic Projections

**Date:** 2026-05-15
**Status:** Accepted

## Context

Atlas ships five issue types: `epic`, `story`, `sub_task`, `bug`, `sub_bug`. The original SQLite schema gave each type its own table (`epics`, `stories`, `sub_tasks`, `sub_bugs`, `bugs`) with its own primary key. Every polymorphic concern in the system — comments, issue_events, agent_runs, notifications, item links, depends_on — therefore had to carry a `(target_type, target_id)` pair, and every service that touched an issue had to switch on `type` to pick the right table.

The cost showed up everywhere. The link table needed five FKs (or no FKs at all). The activity-event service needed five branches to load the linked item. The Owner search had to UNION across five tables. The dependency-guard recursive CTE had to know about five tables to walk a blocker chain. Five parallel indexes had to be kept in sync as the schema evolved. And the `priority` column drift (added everywhere but not exposed in the IStory/IBug/ISubTask/ISubBug interfaces) — documented in `.agents/data-model.md:5` — was a direct consequence of having to add the same column five times.

The constraint that kept the per-type tables originally was the API contract: `/api/epics/...`, `/api/stories/...`, `/api/bugs/...` are stable surfaces consumed by both the web app and external integrations. Collapsing the tables had to preserve every per-type request and response shape.

## Decision

Unify all five issue types into a single `items` table with a `type` discriminator column and a polymorphic `parent_id` / `parent_type` pair, as defined in `001_baseline.sql`. The polymorphic side tables (`comments`, `issue_events`, `agent_runs`, `notifications`) now use a single `item_id` FK to `items(id)` with `ON DELETE CASCADE`. Issue links live in `item_links(from_id, to_id, relation_type)` where `relation_type ∈ {relates_to, depends_on}`.

Preserve the per-type API contracts via **projection layers in `packages/api/src/services/items.ts`** — the route handler receives a request scoped to one type, the service projects out the right shape, and the response goes back as the historical contract demanded. The IEpic / IStory / IBug / ISubTask / ISubBug TypeScript interfaces in `packages/shared/src/types/index.ts` remain distinct; a new unified `IItem` lives in `packages/shared/src/items/types.ts` for code paths that genuinely need polymorphism.

## Consequences

- One table, one set of indexes, one set of triggers. Schema evolution touches one place.
- Polymorphic features (depends_on cycle detection via recursive CTE, FTS via tsvector, the activity event log, item links) all become single-table operations.
- The `priority` regression cannot recur — the column exists on every row by construction.
- The projection layer is now load-bearing. A bug in `services/items.ts` that mis-projects a column will surface as a wrong-shape response on any per-type route.
- External consumers of the API see no change. The `/api/epics/...`, `/api/stories/...`, etc. surfaces still return their historical shapes.
- Type narrowing in TypeScript is more work than it would be with five distinct tables. Services that operate on `IItem` must switch on `type` to access type-specific projections.
