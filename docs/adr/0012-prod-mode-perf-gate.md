# 0012. Prod-Mode Perf Gate at <200ms p95 TTI

**Date:** 2026-07-01
**Status:** Accepted

## Context

The W7 perf chunks committed `e2e/perf/floors.json` with per-route p95 floors derived from `pnpm e2e:perf` running against the Vite dev server. Several floors locked in dev-mode timings that bear no resemblance to what users experience on a production bundle — `/issues` p95 sits at 36.3s and `/projects` at 24.2s, because Vite's first-paint cold-compile tail dominates the load_ms metric. The master plan (`bubbly-sniffing-breeze.md` Phase E) targets <200ms p95 TTI on the hermetic e2e stack, which is unachievable as long as the perf baseline measures dev-mode timing.

Alternatives considered:
- **Drop the perf gate entirely** — rejected. The dev-mode floors still catch dev-stack regressions (e.g. a route that was 24s now takes 240s) and have value as a smoke check, just not as the SLO ceiling.
- **Add `start` script that builds + serves prod, point e2e at it via PORT 6010** — adopted, but with care: `pnpm prod` runs migrations against the production DB on host port 5510 (not `atlas_e2e`). The e2e stack must keep its own DB-+-port isolation.
- **Switch the perf job to use a separate hermetic e2e setup file for prod** — rejected. Two near-identical global-setup files diverge over time. Cheaper to gate the existing `e2e/global-setup.ts` on `ATLAS_E2E_PROD=1` and switch the web spawn from `vite` to `vite preview`.

## Decision

Add a `ATLAS_E2E_PROD=1` env switch to `e2e/global-setup.ts` that swaps the web spawn from `vite` (dev) to `vite preview --strictPort --host 127.0.0.1 --port ${WEB_PORT}` (serves the production build from `packages/web/dist/`). Add a root script `pnpm e2e:perf:prod` that runs `pnpm -F @atlas/web build && ATLAS_E2E_PROD=1 playwright test e2e/perf/ --project=chromium && node scripts/check-perf-floors.mjs --strict`.

Extend `scripts/check-perf-floors.mjs` with a `--strict` flag that enforces an absolute 200ms p95 ceiling on every measured route, in addition to the per-route regression floor. Strict mode is opt-in (only the prod-mode invocation passes it); the dev-mode `pnpm e2e:perf` continues to enforce only the regression floor and is not gated on the absolute ceiling.

Add a new `perf-prod` job to `.github/workflows/perf.yml` mirroring the existing `perf` job's triggers (workflow_dispatch / nightly cron / `run-perf` label) and running the prod-mode pipeline.

## Consequences

- The master plan's <200ms p95 TTI SLO becomes enforceable from CI on every prod-mode run, not just a paper target.
- The dev-mode floors in `e2e/perf/floors.json` remain useful for "did this dev-stack route regress" smoke checks but no longer pose as the SLO. Documentation in `check-perf-floors.mjs` headers makes this distinction explicit.
- The infrastructure ships in this change; the actual prod-bundle baseline regen (and any inline perf-fix work surfaced by the first prod-mode CI run) is a follow-up task. Until then, `pnpm e2e:perf:prod` will likely fail on Windows local runs — that is expected, the gate is a Linux-CI workflow.
- `vite preview` requires the web build to exist; the script chains `pnpm -F @atlas/web build` before the playwright invocation. Without the build, `vite preview` errors with `dist/ not found` rather than silently serving a stale build.
- The Owner is the only one who can lift the dev-mode floors in `e2e/perf/floors.json` to "production-aware" once the first prod-mode CI run lands; the auto-regen step is gated on the `gh workflow run perf.yml` artifact, not a local commit.
