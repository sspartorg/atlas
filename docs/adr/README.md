# Architecture Decision Records

This directory captures the architecturally significant decisions made on the Atlas codebase. An Architecture Decision Record (ADR) is a short markdown file that names a decision, the context that forced it, and the consequences we now live with. The format used here is Michael Nygard's, originally documented at https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions — three sections (Context, Decision, Consequences), no frontmatter, no diagrams unless absolutely necessary. ADRs are immutable once accepted; superseding decisions get a new ADR that explicitly supersedes the old one.

Add a new ADR whenever a choice is expensive to undo: a database engine, a query layer, a schema-shape commitment, a runtime contract between packages, a CI gate, a policy that shapes how future code is written. Skip ADRs for ordinary refactors, library bumps, or cosmetic UI work — those belong in commit messages. Files are numbered `NNNN-kebab-case-slug.md` starting at `0001`. The number is permanent (do not renumber to insert), and the slug should be a short noun phrase that identifies the decision (`postgres-migration`, not `we-moved-to-postgres`). Use `_template.md` as the starting skeleton.

## Index

| # | Title | Date | Status |
|---|---|---|---|
| 0001 | Postgres Migration | 2026-05 | Accepted — migrate from SQLite to Postgres 16 for cascades, GIN indexes, FTS, and concurrent access |
| 0002 | Single Baseline Migration Squash | 2026-06-03 | Accepted — collapse 86+ legacy migrations into one `001_baseline.ts` + append-only rule |
| 0003 | Kysely / Knex Split | 2026-05 | Accepted — Kysely for runtime queries, Knex for schema migrations only |
| 0004 | Unified Items Table with Polymorphic Projections | 2026-05 | Accepted — five issue types share one `items` table; per-type API contracts kept via projection layers |
| 0005 | SSE-First Freshness | 2026-05 | Accepted — no periodic polling; SSE pushes mutations and React Query invalidates on receipt |
| 0006 | MCP HTTP Shim over Stdio | 2026-06-04 | Accepted — MCP host serves at `127.0.0.1:4500/mcp`; clients configure via URL or `mcp-remote` shim |
| 0007 | Marketplace-Only Install Path | 2026-06-04 | Accepted — `runSeed()` never touches `agents`; installs flow through the marketplace |
| 0008 | Federated Horizon SDLC Redesign | 2026-06-03 | Accepted — 17-plan redesign baked in, 552-commit history squashed, remote re-pointed to `atlas` |
| 0009 | Per-Package Coverage Tiers | 2026-05 | Accepted, **amended 2026-09-20** — tier structure stands; the documented floors are stale (web measured 95.4, not 70) and api/web gates are currently red |
| 0010 | Prompt MD over Structured Config | 2026-05-27 | Accepted — agent behavior lives in `agents.prompt_md`; structured config reserved for non-LLM consumers |
| 0011 | iPad Viewport and Three-Viewport Visual Matrix | 2026-07-01 | Accepted — visual snapshots run across three viewports including iPad |
| 0012 | Prod-Mode Perf Gate at <200ms p95 TTI | 2026-07-01 | Accepted — `ATLAS_E2E_PROD=1` runs perf specs against the production bundle with a strict 200ms ceiling |
| 0013 | Initial-Chunk Budget 264 KB gz | 2026-08-04 | Accepted — raised 260 → 264 KB after the third CLI (`ollama`) grew the app shell past 0.1 KB of headroom |
| 0014 | Workflows Replace Per-Agent Schedules and Handoffs | 2026-09-14 | Accepted — a ReactFlow-built workflow graph runs agents back-to-back in one worktree with one PR; agents lose schedules, handoff rules and git flags |
| 0015 | One Task, One Branch, One PR | 2026-09-18 | Accepted — Tasks and Sub-tasks replace epics/stories/bugs; a Task's run works its sub-tasks on one branch and delivers one PR |
| 0016 | Jira Bridge | 2026-09-19 | Accepted — the scheduler imports Jira issues by JQL into Tasks (label → workflow) and mirrors progress and Done back as orchestrator comments, with no AI |
| 0017 | Multi-repo Projects and Tasks | 2026-09-19 | Accepted — a Project holds several repos (its own git fields are the primary); a Task spans one or more, worked side by side in one run, with one PR per changed repo; the Task closes when the last PR merges |
| 0018 | Repos Without a Primary | 2026-09-20 | Accepted — every repo in a project is an ordinary `project_repos` row with its own clone, credential, branch and setup scripts; the project keeps no git fields |
| 0019 | Second Baseline Squash | 2026-09-20 | Accepted — migrations 001-045 collapsed into one regenerated baseline; supersedes 0002 |
