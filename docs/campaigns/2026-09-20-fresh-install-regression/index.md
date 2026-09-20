# fresh-install-regression — the board

> **PLANNED, NOT STARTED — 2026-09-20.** Every task below is `todo`. Nothing has
> been wiped, booted or changed. Read this file, then
> [`checklists/reset-inventory.md`](checklists/reset-inventory.md), before any
> execution session begins.

Atlas is reset to a first-ship state and then proved, page by page, to work
from zero. Disk and Docker are wiped Atlas-only, 45 migrations collapse into
one regenerated baseline, a bot credential onboards a fresh Owner, a
two-repo project runs three graded Tasks, and every route and cross-route
dependency is walked against a written checklist. Findings are logged, then
fixed in severity order, then re-walked.

Opened 2026-09-20 on the Owner's ruling. Authoring plan:
`~/.claude/plans/with-in-this-folder-mossy-liskov.md`. Branch
`campaign/fresh-install-regression` off `main`.

## Board

| # | Task | Scope | Status |
|---|---|---|---|
| 1 | [Squash 45 migrations into one fresh baseline](task-01-migration-squash.md) | api | done |
| 2 | [Factory reset — disk and Docker, Atlas-only](task-02-factory-reset.md) | infra | done |
| 3 | [First boot and onboarding from zero](task-03-first-boot-onboarding.md) | infra | done |
| 4 | [Register the sspart-bot GitHub App credential](task-04-bot-credential.md) | infra | done |
| 5 | [Verify the two sandbox repos](task-05-seed-throwaway-repos.md) | infra | done |
| 6 | [Create the project, add both repos, setup scripts and secrets](task-06-project-two-repos-setup-secrets.md) | infra | done |
| 7 | [Run three graded sample Tasks: small, medium, large](task-07-sample-tasks-small-medium-large.md) | infra | done |
| 8 | [Walk wave A — onboarding, dashboard, scratch pad, projects, repos](task-08-walk-wave-a-projects-repos.md) | web | done |
| 9 | [Walk wave B — tasks, sub-tasks, queue, workflows](task-09-walk-wave-b-tasks-workflows.md) | web | done |
| 10 | [Walk wave C — terminals, agents, marketplace](task-10-walk-wave-c-terminals-agents.md) | web | done |
| 11 | [Walk wave D — settings, credentials, guard-rails, notifications, reminders](task-11-walk-wave-d-settings-admin.md) | web | done |
| 12 | [Walk wave E — search and analytics](task-12-walk-wave-e-read-surfaces.md) | web | done |
| 13 | [Cross-dependency sweep — the twelve chains](task-13-cross-dependency-sweep.md) | api · web | done — X-8 blocked (no Jira site) |
| 14 | [Fix batch — P0 and P1 findings](task-14-fix-batch-p0-p1.md) | api · web | done |
| 15 | [Fix batch — P2 and P3 findings](task-15-fix-batch-p2-p3.md) | api · web | todo — depends on 14 |
| 16 | [Prove and close the index gaps](task-16-perf-and-indexes.md) | api | todo |
| 17 | [Name cleanup — CER, DHEQ, JDA all become ATL](task-17-name-cleanup-atl.md) | shared · api · web · docs | todo |
| 18 | [Coverage lift against the ADR 0009 tiers](task-18-coverage-lift.md) | api · web · mcp | todo |
| 19 | [Security audit — evidence-based, targeted](task-19-security-audit.md) | api · infra | todo |
| 20 | [Refresh the user guide and its screenshots](task-20-docs-guide-refresh.md) | docs | todo |
| 21 | [Sync `.agents/` and write the ADRs](task-21-agents-sync-and-adrs.md) | docs | todo |
| 22 | [Final regression and close the campaign](task-22-final-regression-and-close.md) | all | todo |

Row numbers are permanent. A row's status and its task file's `**Status:**`
line flip in the same commit. Checkboxes live in the task files, never here.

## Why

Atlas has never been proved to install from nothing. The current workspace
carries eighteen months of accretion: 45 migrations stacked on a baseline that
was itself a squash of 86, six leftover databases inside one Docker volume, a
sandbox project, and an encryption key created on 11 Aug that no first-boot
path has exercised since. Every prior test ran against that accumulated state.

Three consequences the Owner wants removed:

- A new adopter's first run is untested. `db-up.ts` reuses an existing
  container, so nobody on this machine has ever watched `pnpm dev` build one.
- The migration history no longer tells the schema story. ADR 0002 made this
  point at 86 files; it is true again at 45.
- The user guide documents 11 of 34 pages and predates Tasks, Workflows,
  Terminals, Jira, Credentials and multi-repo projects entirely.

The campaign fixes all three by doing the thing a new adopter does — install
from zero — and refusing to skip a step.

## Owner rulings

This board's law. Each was ruled before authoring began; none is reopened
without a new ruling recorded here.

| # | Ruling |
|---|---|
| D-1 | The wipe is **Atlas-scoped only**. `dhequest1-*`, `dhequest2-*`, `dhequest-backup-*`, `shopping-site_*` and `neel-postgres` are untouchable. `docker system prune` is forbidden in every form. |
| D-2 | ~~Two throwaway repos are created under `sspartorg`~~ - **amended 2026-09-20**: the org already holds `atlas-sdlc-sandbox` and `atlas-sdlc-sandbox-web`, both real Node projects whose tests pass (43 and 10). The pair is reused and **no repos are created**, avoiding permanent artifacts in the org and the risk of an App installation scoped to selected repositories. |
| D-3 | `CER`, `DHEQ` and `JDA` all become `ATL`. "Linoes" and "insightsoftware" do not exist in this repo — searched across the working tree, every gitignored directory, all commit messages and every blob in `git rev-list --all`. |
| D-4 | The campaign lives in git under `docs/campaigns/`, not in `.agents/` (barred by `.agents/conventions.md`) and not in `.claude/plans/` (untracked). |
| D-5 | ADR 0009's coverage tiers stand. `shared`/`api`/`mcp` hold at 95%+; `web` rises 70 → 80 lines with the real gap closed by e2e. ADR 0009 is amended, not overturned. |
| D-6 | `~/.config/Atlas/workspace.key` is deleted. On macOS this is irreversible — `crypto.ts` has no machine-ID fallback and falls through to random bytes. Acceptable only because the database holding every ciphertext dies in the same step. |
| D-7 | Migrations collapse to one regenerated `001_baseline.{ts,sql}`. 002–045 are deleted. ADR 0019 supersedes ADR 0002. |
| D-8 | The three sample Tasks are graded, and the large one spans **both** repos — otherwise the multi-repo workspace, sub-task decomposition and one-Task-many-PRs paths go untested. |
| D-9 | The walk **logs every finding and fixes nothing inline**. Fixes happen in tasks 14 and 15, severity-ordered, each with a regression test. Discovery stays separate from repair so one deep bug cannot stall the sweep. |
| D-10 | Perf and security are evidence-based and targeted. No STRIDE pass, no SBOM, no threat-model document. |

## Standing constraints

Each names the gate it would break.

- **`packages/shared` is not edited** without an explicit Owner instruction and
  a stated reason (AGENTS.md hard rule 1). Task 17 touches `shared` test files
  and two comments only; if it needs a type change, it stops and asks.
- **Status logic stays in `packages/shared/src/status-machine/`** (hard rule 2).
  No task adds a transition table to a route, component or hook.
- **API responses match `@atlas/shared` types exactly**, snake_case throughout
  (hard rule 4). No task adds a field that is not in the interface.
- **No audit or forensic artifact is committed** (hard rule 6). `findings.md`
  carries prose plus `file:line` evidence; screenshots, `.har`, `.ndjson`,
  `e2e-logs/`, `test-results/` and `playwright-forensic-report/` stay local.
  Before every `git add`, staged and untracked entries are eyeballed.
- **Migrations are append-only after task 1.** The regenerated baseline is
  written once; every later schema change is `002_*.ts`. Task 16's indexes go
  into `002`, not into the baseline.
- **`.agents/` is updated in the same change** as any behaviour it documents
  (AGENTS.md self-update rule). Task 21 is the backstop, not the excuse — a
  task that changes a button updates its page doc itself.
- **Coverage floors gate CI per package.** `pnpm -w run gate` fails on any
  package below its own floor; a task that deletes a test without replacing
  coverage breaks the build.
- **Commits follow `<type>(<scope>): <summary>`**, summary ≤ 60 chars and
  imperative, with a `Refs:` line on issue-attached work. Never `--no-verify`,
  never `--amend` (`.agents/conventions.md`).

## Gates

The campaign closes only when all of these are green and pasted into
[task-22](task-22-final-regression-and-close.md):

`pnpm -w run gate` — typecheck, knip, per-package coverage floors, build,
bundle budget. `pnpm e2e` — 86 specs. `pnpm -F @atlas/api test` against a fresh
`atlas_test` built from the new baseline. A clean `pnpm dev` on a machine with
no `atlas-postgres` container, no `atlas-pg` volume and no `workspace.key`,
reaching `/onboarding` with no console error.

## Out of scope

Multi-user auth, hosted deployment, Windows parity testing of the setup-script
PowerShell path, and any fix whose blast radius exceeds the page it was found
on — those get their own campaign.
