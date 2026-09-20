# 0009. Per-Package Coverage Tiers

**Date:** 2026-05-24
**Status:** Accepted. **Amended 2026-09-20** — the floor table below is stale by a wide margin; see *Amendment* at the end for measured values.

## Context

Atlas is a four-package monorepo: `@atlas/shared` (pure types, constants, schemas, status machine), `@atlas/mcp` (MCP tool surface — thin wrappers over the HTTP API), `@atlas/api` (Fastify routes + services + DB), `@atlas/web` (React UI). The four packages have radically different testability profiles:

- `shared` is pure functions over plain data — no DB, no network, no UI. Every line is mechanically reachable from a unit test.
- `mcp` is a tool layer over HTTP. Each registration adds two functions (metadata + handler); tests exercise registration plus the handler logic, but full handler coverage requires an end-to-end harness.
- `api` services exercise a real Postgres (via the test-template fixture) and represent the largest single-test surface in the repo. Coverage is achievable but limited by FK-protected defensive null-coalesce branches and platform-specific code (`crypto.ts` HKDF / Windows registry paths) that cannot exercise on a single CI runner.
- `web` is React components, page-level smoke tests, and a growing Playwright suite. Large modals (700-1800 LOC each) and the active-development surfaces (`Agents.tsx`, `AgentDetail.tsx`, `Queue.tsx`) are intentionally excluded from unit coverage in favor of Playwright integration tests.

A single uniform coverage floor would have to be either low enough to admit `web` (which would let `shared` regress without consequence) or high enough to gate `shared` (which would block `web` work forever). Neither is honest. The right answer is per-package floors that reflect what is genuinely achievable for each package's testability profile. The full rationale, including the "honest floor" measurements taken on 2026-05-24, lives in `.agents/testing.md:1-78`.

## Decision

Each package gates CI at its own coverage threshold, configured in its own `vitest.config.ts` under `test.coverage.thresholds`. The tiers:

| Package | Target | Honest floor (2026-05-24) |
|---|---|---|
| `@atlas/shared` | 100% | 100% across the board |
| `@atlas/mcp` | 95% | lines 85, statements 85, functions 60, branches 90 |
| `@atlas/api` | 95% | lines 95, statements 95, functions 95, branches 86 |
| `@atlas/web` | 80% | lines 70, statements 70, branches 65, functions 59 |

The "honest floor" is the measured number CI actually enforces today; the "target" is where the package should sit once the documented backfill work lands. `pnpm -w run gate` runs the full pre-merge chain (typecheck, knip, test:coverage, build) and fails on any package missing its own floor.

## Consequences

- CI has a credible gate: every package must stay above its measured floor. A single missed test that drops `api` from 96% lines to 94% lines breaks the build.
- The four floors are honest — they reflect what is reachable today, not aspirational marketing numbers. A future contributor cannot accidentally ship a test deletion that would have failed under a uniform 90% gate.
- Per-package thresholds require per-package discipline. When work moves between packages, the contributor must update the relevant threshold or accept a CI break.
- The `web` floor is below the long-term target. Backfill work (hooks + view-model tests for Theme 08/09/11 additions) is documented in `.agents/testing.md` as the path back to 80%.
- Active-development surfaces and Playwright-covered modals are excluded from coverage measurement entirely (`Agents.tsx`, `AgentDetail.tsx`, `Queue.tsx`, the heavy modals). That exclusion is the only way the `web` floor remains both honest and achievable.
- New packages added to the monorepo must declare their own threshold tier in their `vitest.config.ts`. There is no default.

---

## Amendment — 2026-09-20 (fresh-install regression campaign)

The tier **structure** stands. The **numbers** in the table above do not: they
were never updated as the packages improved, and they now understate reality so
badly that reading this ADR gives a false picture of the codebase.

Measured on 2026-09-20 against the re-squashed baseline:

| Package | This ADR says | `vitest.config.ts` enforces | Actually measured | Gate |
|---|---|---|---|---|
| `@atlas/shared` | 100 across the board | 100 / 100 / 100 / 100 | **100 / 100 / 100 / 100** | passes |
| `@atlas/mcp` | lines 85, stmts 85, funcs 60, branches 90 | 95 / 95 / 95 / 95 | **100 / 100 / 100 / 100** | passes |
| `@atlas/api` | lines 95, stmts 95, funcs 95, branches 86 | 98 / 98 / 98 / 96 | 94.81 / 93.76 / 94.54 / 86.67 | **fails** |
| `@atlas/web` | lines 70, stmts 70, branches 65, funcs 59 | 97 / 96 / 94 / 94 | 95.43 / 94.20 / 91.65 / 90.60 | **fails** |

(lines / statements / functions / branches)

Two things follow.

**The documented floors are obsolete in the generous direction.** `web` is at
95.43% lines, not the 70% recorded above — the package improved by roughly
twenty-five points and the ADR never moved. `mcp` reached 100%, not 60%
functions. Anyone planning work from this document's numbers would badly
mis-estimate where the gaps are.

**Two configured gates are currently red.** `api` and `web` have thresholds
ratcheted above their measured values, so `pnpm -w run gate` fails on both.
That contradicts this ADR's central idea — the "honest floor", *"the measured
number CI actually enforces today"*. A threshold nobody meets is not a floor;
it is an aspiration that turns a red build into background noise.

`shared` was also below its own 100% gate when measured (99.21% lines, 94.11%
functions). The single gap was `schemas/index.ts:660-664`, the `site_url`
origin rule that permits plain http only on loopback. It is now covered, and
the package is back at 100%.

**Unresolved, and deliberately left to the Owner:** whether to lower `api` and
`web` to measured-minus-a-buffer (restoring this ADR's honest-floor intent) or
to leave them high and do the work to reach them. Both are defensible; picking
one is a product decision about where test effort goes, not a mechanical fix,
and lowering a gate is not something an agent should do unasked.
