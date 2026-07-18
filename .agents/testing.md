# Testing

This repo ships a CI-gated test suite with **tiered coverage targets per package**. Targets are enforced inside each package's `vitest.config.ts` so CI fails on threshold miss without bespoke YAML.

## Tiered coverage targets

| Package | Target | Active floor (2026-07-01) | Measured | Why |
| --- | --- | --- | --- | --- |
| `@atlas/shared` | **100%** | 100% / 100% / 100% / 100% | 100 / 100 / 100 / 100 | Contract surface. Pure functions, no DB, no UI. Other packages depend on its types/constants/schemas/status-machine. No excuse for gaps. |
| `@atlas/mcp` | **95%** | 95 / 95 / 95 / 95 | (last full-suite run cleared the gate) | Each MCP tool registers two functions (metadata + async handler); the tests exercise registration + every handler. `api-client.ts` is excluded with rationale (wrapper layer exercised indirectly via the tools tests). |
| `@atlas/api` | **95%** | **lines 95 · stmts 95 · branches 88 · functions 97** | 96.37 / 96.37 / 89.09 / 98.09 | Hits a real PostgreSQL via `atlas_test_v2`. Lifted 2026-07-01 from 94/94/87/97 → 95/95/88/97 after the v2 coverage push landed +297 route integration tests + +7 re-authored agents.test.ts tests. Branches at 88 reflects defensive null-coalesce + platform-branch code (`crypto.ts`, `env-file.ts`, `issue-full.ts`) that's covered with `/* v8 ignore */` where unreachable. The master plan target of 95 on branches is a future-session lift once those defensive paths are pared down. |
| `@atlas/web` | **95%** | **lines 97 · stmts 97 · branches 94 · functions 95** | 98.88 / 98.88 / 94.98 / 95.27 | Honest measured floor as of the v2 push. The W1 chunks landed comprehensive unit coverage across modals, terminal surface, agent tabs, and the shell. Branches set at 94 to absorb v8 instrumentation jitter — the de-facto floor is 94.98+ but the same test set produces ±0.2pp variance on a ~10000-branch denominator. |

Thresholds live in each package's `vitest.config.ts` under `test.coverage.thresholds`. All four package gates are **active**.

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

`.github/workflows/test.yml` runs `pnpm -F <pkg> test:coverage` per gated package. The workflow uses `pnpm/action-setup@v4` and `actions/setup-node@v4` with the pnpm cache. All four packages â€” shared, mcp, api, web â€” are gated today.

`pnpm lint:knip` also runs in CI as a non-blocking report (`continue-on-error: true`). The Task-4 baseline of 66 unused exports is documented; promote to a failing step once that's investigated.

## What's deferred

Remaining test-surface work for future sessions:

- **Branches + functions gap on web** â€” lift from 69 / 63 toward 80 by covering modal `open === false`, `disabled`, `loading`, `danger` branches in the picker components, and exercising more of the inline render helpers inside the larger detail pages.
- **Excluded modals on web** â€” the 13 heavy multi-state modals (`NewProjectModal`, `NewIssueModal`, etc.) are slated for Playwright integration coverage rather than unit tests.
- **Branches gap on api** â€” lift from 93.97% to 95% by covering the `envFileService.write` path (via a tmpdir-rooted test fixture) + a few defensive issue-tree guards.
- **Subprocess wrapper coverage** â€” if a future session wants to lift the runners into the gate, it'll mock `node:child_process` and assert spawn args + SSE event emissions.

## E2E (Theme 13 â€” Playwright)

`pnpm e2e` runs the greenfield Playwright suite at the repo root. The setup owns a dedicated `atlas_e2e` Postgres DB + isolated api on :6001 + web on :6000, so it never collides with `pnpm dev` (4000/4001) or `pnpm prod` (5000/5001). Layout, spec catalogue, and the backfill list live in `docs/regression-2026-05.md`.

- `pnpm e2e` â€” full headless suite (~7 minutes wall-clock)
- `pnpm e2e:headed` â€” opens a browser window per spec; slower, useful for debugging
- `pnpm e2e:update-snapshots` â€” re-baseline visual snapshots (currently off; turn on when spec set grows)
- `pnpm e2e:report` â€” opens the HTML report after a run
- `pnpm gate:full` â€” `pnpm gate` + `pnpm e2e` together (long, for pre-release)

**First release ships 8 page specs + 1 sidenav-walk flow** (9 total). The remaining ~19 specs from the original Theme 13 design are catalogued in `docs/regression-2026-05.md` as backfill, each implementable against the established pattern in â‰¤30 lines.
