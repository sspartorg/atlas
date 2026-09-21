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

**Resolved by the Owner, 2026-09-20: rebaseline as a ratchet.** The enforced
number is once again the measured number, which is what "honest floor" meant in
the first place. Thresholds are set to measured-minus-0.5pp (a v8
instrumentation jitter allowance) and are raised whenever coverage genuinely
improves — never ahead of a measurement.

The reasoning was that a threshold nobody meets is not a gate. `pnpm gate`
failed on `api` and `web` every single run, which does not protect the codebase;
it trains everyone to ignore a red build, and a genuine coverage regression then
lands invisibly underneath the pre-existing failure. A green gate that breaks on
a real drop is worth more than a red one that asserts an ambition.

Measured on a clean run (shared 246 tests, mcp 167, api 2645, web 4152) and now
enforced:

| Package | Measured (lines / stmts / funcs / branches) | Enforced |
|---|---|---|
| `@atlas/shared` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `@atlas/mcp` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `@atlas/api` | 94.81 / 93.77 / 94.55 / 86.63 | 94.3 / 93.2 / 94 / 86.1 |
| `@atlas/web` | 95.40 / 94.14 / 91.58 / 90.53 | 94.9 / 93.6 / 91 / 90 |

### Amended 2026-09-21 — the ratchet turned

The confidence-close campaign raised the measurement rather than lowering the
bar again. Measured on a clean run (shared 246, mcp 167, **api 2709**,
**web 4358**):

| Package | Measured (lines / stmts / funcs / branches) | Enforced |
|---|---|---|
| `@atlas/shared` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `@atlas/mcp` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| `@atlas/api` | **96.11 / 95.11 / 96.69** / 87.85 | 95.5 / **95** / 96 / 87.3 |
| `@atlas/web` | **97.31 / 96.19 / 95.08** / 92.51 | 96.8 / 95.7 / **95** / 92 |

Six of the eight non-branch metrics across `api` and `web` are now at or above
95; before this campaign, one was. Where a metric crosses the Owner's stated
95% bar it is enforced at **exactly 95**, not measured-minus-jitter, so a slide
back under the bar fails the gate instead of being absorbed.

**Branches are a ceiling, and this ADR should say so rather than imply a
target.** `api` sits at 87.85 and `web` at 92.51. Reaching 95 on `api` would
mean covering ~450 further branches, and what remains is overwhelmingly
defensive: `if (!row) return`, `?? null`, catch arms unreachable in practice.
On `web` it is concentrated in `App.tsx`'s `lazyNamed(() => import(...))` route
closures — e2e's job — and react-flow canvas internals that jsdom's no-op
`ResizeObserver` never lets render.

Tests written to execute those assert that nothing happens. They cost
maintenance forever, catch nothing, and `pnpm e2e` already walks the real paths.
The campaign's own precedent is task-16 of its predecessor: seven "obvious"
index gaps, exactly one real, the other six permanent write cost bought with
nothing. Excluding those files from coverage to flatter the number would be the
same mistake as lowering a floor to meet it, and was rejected for the same
reason.

`mcp` moved **up**: it measured 100 while gating at 95, so five points of real
coverage were unprotected. A ratchet locks gains in as well as catching losses.

The targets in the Decision table above remain targets — `api` branches at
86.63 is genuinely below where this package should sit, and the gap is still
concentrated in defensive null-coalesce and platform-specific branches. The
difference is that the ambition now lives in prose, where it belongs, instead
of in a CI gate that fails regardless of whether anyone regressed anything.
