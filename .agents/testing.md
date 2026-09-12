# Testing

This repo ships a test suite with **tiered coverage targets per package**. Targets are enforced inside each package's `vitest.config.ts`, so `test:coverage` fails on a threshold miss without bespoke YAML — but note that **nothing runs it in CI**; see [CI](#ci).

## Tiered coverage targets

| Package | Target | Active floor (2026-07-01) | Measured | Why |
| --- | --- | --- | --- | --- |
| `@atlas/shared` | **100%** | 100% / 100% / 100% / 100% | 100 / 100 / 100 / 100 | Contract surface. Pure functions, no DB, no UI. Other packages depend on its types/constants/schemas/status-machine. No excuse for gaps. |
| `@atlas/mcp` | **95%** | 95 / 95 / 95 / 95 | (last full-suite run cleared the gate) | Each MCP tool registers two functions (metadata + async handler); the tests exercise registration + every handler. `api-client.ts` is excluded with rationale (wrapper layer exercised indirectly via the tools tests). |
| `@atlas/api` | **98%** | **lines 98 · stmts 98 · functions 98 · branches 96** | ⚠️ 95.51 / 95.16 / 95.5 / 90.67 — **below floor** | Hits a real PostgreSQL via `atlas_test_v2`. Branches sits lowest because of defensive null-coalesce + platform-branch code (`crypto.ts`, `env-file.ts`, `issue-full.ts`), covered with `/* v8 ignore */` where genuinely unreachable. **2026-09-12: 2890/2890 pass on macOS.** The three that had been written off as "Windows-only branches that cannot pass on a POSIX runner" were fixable and are fixed: `crypto.test.ts` ×2 now `vi.doMock('node:os')` to fake `platform() === 'win32'` before the dynamic import (with `doUnmock` + `resetModules` in a `finally`), and `git-verify.test.ts` ×1 stopped depending on POSIX `basename` — `deriveProjectName` is separator-agnostic (`split(/[\\/]/)`), which is a real fix, not a test accommodation. The older "19 tests across 5 files" note was stale before that. One further failure was fixed rather than recorded: the suite was **order-dependent** because `routes/cli-models.test.ts` and `services/cli-models.test.ts` each `TRUNCATE cli_models` and never restore it, so every file that ran afterwards inherited a registry hole — and `agents` carries a composite FK on `(cli, model)`, so any later test installing a catalog agent whose model had been wiped blew up. `truncateAll()` now re-seeds `cli_models` (reference data, not test data); the two files that want it empty truncate after calling it, so they are unaffected. Nothing runs any of this in CI (see [CI](#ci)), which is how both the staleness and the ordering bug went unnoticed. |
| `@atlas/web` | **95%** | **lines 97 · stmts 96 · branches 94 · functions 94** | 97.2 / 96.14 / 94.13 / 94.79 | Honest measured floor. Branches set at 94 to absorb v8 instrumentation jitter — the same test set produces ±0.2pp variance on a ~10000-branch denominator, so the headroom here is real but thin.  **2026-09-12: 4693/4693 pass, but the suite was order-dependent** — `ScratchPadEditor.test.tsx` passed alone and failed after `GuardrailScriptsTab.test.tsx`, because its `formatSavedAgo` test advanced 2 hours of fake time through a component with a 1s `setInterval` (7,200 re-renders in one `act()`, ~14s against a 15s timeout) and its fake-timer tests restored real timers only on their last line, so one timeout hung the rest of the file. Both fixed. A green run is evidence about *that ordering* — if a test passes alone and fails in the suite, look for leaked global state before blaming machine load. |

Thresholds live in each package's `vitest.config.ts` under `test.coverage.thresholds`, and are enforced whenever you run `test:coverage` **locally**. Nothing runs them automatically — see [CI](#ci).

## Coverage gate (Theme 12)

`pnpm -w run gate` runs the full pre-merge chain:

1. `pnpm -r typecheck` â€” type-strict everywhere
2. `pnpm -w run lint:knip` â€” no unused exports / files
3. `pnpm -r test:coverage` â€” every package's threshold enforced
4. `pnpm -r build` â€” clean prod artifacts

Two helper scripts:

- `pnpm -w run coverage:diff` â€” per-package markdown table of current numbers (paste into PR descriptions).
- `pnpm -w run coverage:assertion-density` â€” flags test files with fewer than 0.8 `expect()` calls per `it()` block. Informational by default; set `STRICT=1` for fail-on-miss posture.

A `.husky/pre-push.optional` template lives in the repo for owners who want the gate to fire on every push (symlink it to `.husky/pre-push`). It's intentionally not the default â€” the gate takes ~5â€“10 minutes and the project's direct-to-main commit cadence prefers lighter pre-commit checks. The secretlint pre-commit hook stays mandatory regardless.

## Floor exceptions (api)

The api package lands at lines/statements/functions â‰ˆ 96% and branches â‰ˆ 86.85% across the non-excluded surface. The gap below pre-migration 98/93 is concentrated in:

- `crypto.ts` (71.42% branches) â€” `keyPath()` chooses between `%APPDATA%` (Windows) and `$HOME/.config` (macOS/Linux), and the new HKDF derivation path branches on `MachineGuid` (Windows reg query), `/etc/machine-id`, `/var/lib/dbus/machine-id`, and the randomBytes fallback. On any single CI runner most platform branches are unreachable.
- `env-file.ts` (85.45% branches) â€” `envFileService.write` mutates the api package's own `.env` at the project root. Testing it would clobber the developer's working file. Read path is fully covered.
- `issue-full.ts` (75.6% branches) and `issue-tree.ts` (84.84% branches) â€” defensive `if (!epic || !project) continue` guards and `epic ? ... : null` ternaries for FK-protected lookups. The orphan path was SQLite-only; PG's `items_check_parent` trigger makes the false side unreachable. The most direct ones in `issue-tree.ts` carry `/* v8 ignore next */` annotations.
- `prompt-builder.ts` (78.57% branches) â€” null-coalesce on optional issue fields (`description`, `spec_md`, etc.) where seed fixtures don't cover every null/non-null combination.
- `counts.ts` (60.86% branches) â€” switch-case across the 5 issue types; seed fixtures use a subset of priority/severity values.
- `external notification.ts`, `events-log.ts`, etc. â€” small `catch` branches around network/parse errors that are caught but not deeply asserted.

### Active-development exclusions (post-2026-05-16 audit)

The agent-scheduler rewrite landed after the audit (`bd903c7`, `af0e6d6`, `8426f11`, `e07f344`, `4bd76e9`, etc.) and the supporting services were not unit-tested in lock-step. They are **excluded from coverage** today and slated for backfill once the scheduler design stabilizes:

- `agent-defaults-sync.ts`, `agent-defaults.ts` â€” startup catalog sync + static defaults.
- `agent-dispatcher.ts`, `agent-memory.ts`, `agent-schedule-registry.ts` â€” scheduler hot-path (has thin tests; not at floor).
- `agents.ts` â€” agents CRUD (no dedicated test file; covered loosely by E2E).
- `compile-prompt.ts`, `dependency-guard.ts`, `dry-run.ts` â€” new agent-runtime features.
- `mcp-config-writer.ts`, `tool-catalog-sync.ts` â€” generated-config + tool catalog sync.
- `items.ts`, `item-links.ts` â€” unified-items library helpers; covered indirectly by every entity-service test.
- `src/db/knex-config.ts`, `src/db/types.ts`, `src/db/run-migrations.ts` â€” DB infra (startup-only or CLI entry).
- `src/plugins/mcp-auth.ts` â€” covered indirectly by route-level write-gate tests.

A future session can close these to lift branches back to â‰¥93 and lines back to â‰¥98.

## Floor exceptions (web)

The web package lands at lines/statements 78.06%, branches 69.48%, functions 63.81%. The gap below 80% is concentrated in:

- **Branches at 69** â€” pickers and modals carry lots of `open === true | false` guards plus conditional menu-item rendering. Smoke tests exercise the happy paths but skip many of the `disabled`, `loading`, `danger`, and `pre-confirm` variants.
- **Functions at 63** â€” large page components (e.g. `EpicDetail`, `StoryDetail`) declare many small inline render helpers and per-row callbacks. Page-level smoke tests cover the canonical render but don't trigger every interactive callback.
- **Excluded surfaces**: heavy multi-state modals (`NewProjectModal`, `ProjectEnvSecretsModal`, `CredentialModal`, `NewIssueModal`, etc. â€” heavy files at 700-1800 LOC each) are excluded from `coverage.include` and slated for Playwright integration coverage instead. `App.tsx`, `Onboarding.tsx`, and the active-development surfaces (`Agents.tsx`, `AgentDetail.tsx`, `Queue.tsx`, `pages/agents/**`, `pages/queue/**`) are also excluded.

A future session can close these to lift branches and functions toward 80%; the floor is set at the achieved % today to give CI an honest, holding gate.

## Running tests locally

```bash
pnpm test                       # all packages, no coverage
pnpm test:coverage              # all packages, with coverage reports

pnpm -F @atlas/shared test:coverage   # one package
pnpm -F @atlas/api test:watch         # watch mode while editing
```

Coverage reports land at `packages/<pkg>/coverage/`. Open `coverage/index.html` for the per-file drill-down; CI consumes the `coverage/coverage-summary.json` if you want machine-readable output.

## File layout

- **Co-locate tests next to source**: `src/services/foo.ts` â†” `src/services/foo.test.ts`. Vitest picks them up via `include: ['src/**/*.test.{ts,tsx}']`.
- **`tests/` top-level folder is for shared test helpers + E2E.** In api: `tests/_pg-db.ts` (template-DB PG fixture), `tests/_items.ts` (unified-items hand-rolled factories), `tests/e2e-lifecycle.test.ts`, `tests/_global-setup.ts` (Knex migration runner that runs once before any test). The `_*.ts` files are excluded from coverage; they're test infrastructure, not source.
- **One concern per test file.** Don't bundle service unit tests and route integration tests in the same file.

## When code is genuinely unreachable

For defensive branches the type system already guarantees can't fire (e.g. a `?? defaultValue` after an enum-typed lookup), use a `/* v8 ignore next */` comment immediately above with a one-line justification:

```ts
// TS guarantees the lookup hits; the `?? status` only fires on out-of-enum strings.
/* v8 ignore next */
return labels[status as IssueStatus] ?? status;
```

Two rules:
- **Always include a justification**. A bare `/* v8 ignore */` is a code smell.
- **Don't ignore the test path**. If you can write a test that reaches the branch, write it.

## Excluded from coverage (api)

Some api files are intentionally excluded from `coverage.include`:

- **Subprocess wrappers**: `agent-runner`, `auto-fetch-runner`, `clone-runner`, `delete-runner`, `reclone-runner`, `git-status`, `git-verify`. Each `spawn()`s an OS-specific external process (PowerShell, git, CLI tools). Correctness is verified by manual smoke; unit-testing the orchestration via `vi.mock('node:child_process')` proves only that the args were assembled correctly, not that the subprocess does the right thing.
- **Routes** (`src/routes/**`): Fastify glue layers (schema parse â†’ service call â†’ response shape). The E2E lifecycle test exercises them end-to-end via `app.inject`; per-route integration tests would duplicate that surface. A dedicated route-test session could lift them into the gate.
- `server.ts`, `main.ts`, `scripts/**`, `db/migrations/**`, `db/seed.ts` â€” entrypoints and data, not business logic.

## CI

**Partially, since 2026-09-12.** The Actions-spend constraint still holds — the
expensive suites are not per-commit gates — but "nothing runs automatically" was
costing more than it saved: three attribution bugs, a dashboard counter frozen at
20, two API query filters that silently ignored their arguments, and 14 red e2e
specs all survived unnoticed because every check was opt-in and manual.

| Workflow | Trigger | What it runs |
|---|---|---|
| `.github/workflows/build.yml` | push (main) · PR | `pnpm -r build` → `pnpm -F @atlas/web bundle:check` |
| `.github/workflows/gate.yml` → `fast` | push (main) · PR | `pnpm -r typecheck` → `pnpm -r lint` → shared / web / mcp tests. No service container, no browser download — the cheap job. |
| `.github/workflows/gate.yml` → `api` | **nightly · manual** | `pnpm -F @atlas/api test` against a Postgres service container. |
| `.github/workflows/gate.yml` → `e2e` | **nightly · manual** | `pnpm db:up` + Chromium + `pnpm e2e` across all three viewport projects (~9 min). |
| `.github/workflows/lighthouse.yml` | nightly · manual | Lighthouse audit |

Two deliberate choices in `gate.yml`, both documented in its header comment:

- The `api` job runs `test`, **not** `test:coverage`. The api thresholds sit
  above the measured numbers (see the table above), so gating on them would make
  the job red from the first run — and a permanently-red gate is one everyone
  learns to ignore. Raise the coverage gate as its own change.
- The `e2e` job brings Postgres up with `pnpm db:up`, **not** a `services:`
  container. `e2e/global-setup.ts` recreates `atlas_e2e` via
  `docker exec atlas-postgres psql …`, so the container must exist under that
  exact name; a `services:` Postgres answers on the port but has no such
  container, and setup would fail before the first spec ran.

To promote e2e to a per-PR gate, add `pull_request:` to `on:` and drop the `if:`
from the `api` / `e2e` jobs. That is a spend decision, not a technical one.

`pnpm -r test:coverage` and `pnpm lint:knip` remain **local-only gates** (knip currently fails at HEAD on pre-existing unused exports). The practical consequence: coverage and test regressions are invisible until someone runs them by hand, which is exactly how the api package drifted below its own floor (see the table above). Run `pnpm -w run gate` before pushing anything non-trivial — it is the only thing standing in for CI.

The one gate that IS enforced remotely is the **web bundle budget** (`bundle:check` in `build.yml`), which fails the Build workflow on every push and PR.

## What's deferred

Remaining test-surface work for future sessions:

- **Branches + functions gap on web** â€” lift from 69 / 63 toward 80 by covering modal `open === false`, `disabled`, `loading`, `danger` branches in the picker components, and exercising more of the inline render helpers inside the larger detail pages.
- **Excluded modals on web** â€” the 13 heavy multi-state modals (`NewProjectModal`, `NewIssueModal`, etc.) are slated for Playwright integration coverage rather than unit tests.
- **Branches gap on api** â€” lift from 93.97% to 95% by covering the `envFileService.write` path (via a tmpdir-rooted test fixture) + a few defensive issue-tree guards.
- **Subprocess wrapper coverage** â€” if a future session wants to lift the runners into the gate, it'll mock `node:child_process` and assert spawn args + SSE event emissions.

## E2E (Theme 13 â€” Playwright)

**Two things that cost real time on 2026-09-12, both worth knowing before
debugging a red spec:**

- **Never edit `packages/api/src` or `packages/web/src` while `pnpm e2e` is
  running.** `global-setup.ts` spawns the API as `pnpm --filter @atlas/api dev`,
  i.e. `tsx watch`. A save restarts it mid-run, and a save that does not parse
  kills it with an uncaught `TransformError` — every spec from that point on
  fails with proxy `502` / `ECONNREFUSED 127.0.0.1:6001` and looks like 12
  unrelated regressions. `e2e-logs/api.log` is where the real cause is; check it
  before believing a wave of failures. Note the logs are opened with `flags:
  'w'`, so the next run overwrites them — read them before re-running.
- **The CLI stand-ins must stay executable.** `e2e/fixtures/fake-claude.js` and
  `fake-copilot.js` are handed to `node-pty.spawn()` as the binary and rely on
  their `#!/usr/bin/env node` shebang. They were committed `100644`; on POSIX
  the exec fails, the PTY dies on spawn, and the session flips to `paused`,
  which reads as a product bug in the lifecycle spec and is not one. Both are
  `100755` in the index as of 2026-09-12 — `git ls-files -s e2e/fixtures` if a
  terminal spec starts failing on session status.

`pnpm e2e` runs the greenfield Playwright suite at the repo root. The setup owns a dedicated `atlas_e2e` Postgres DB + isolated api on :6001 + web on :6000, so it never collides with `pnpm dev` (4000/4001) or `pnpm prod` (5000/5001). Layout, spec catalogue, and the backfill list live in `docs/regression-2026-05.md`.

- `pnpm e2e` â€” full headless suite (~7 minutes wall-clock)
- `pnpm e2e:headed` â€” opens a browser window per spec; slower, useful for debugging
- `pnpm e2e:update-snapshots` â€” re-baseline visual snapshots (currently off; turn on when spec set grows)
- `pnpm e2e:report` â€” opens the HTML report after a run
- `pnpm gate:full` â€” `pnpm gate` + `pnpm e2e` together (long, for pre-release)

**First release ships 8 page specs + 1 sidenav-walk flow** (9 total). The remaining ~19 specs from the original Theme 13 design are catalogued in `docs/regression-2026-05.md` as backfill, each implementable against the established pattern in â‰¤30 lines.
