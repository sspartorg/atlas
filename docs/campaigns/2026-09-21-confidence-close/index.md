# confidence-close — the board

> **OPEN — 2026-09-21.** Closes the seven gaps the fresh-install regression
> campaign could not finish, and re-proves the machine gates that four
> post-campaign PRs have landed on top of since.

The Owner asked of the 2026-09-20 campaign: *"is it all completed, are you 100%
confident?"* The honest answer was no. That campaign closed 22/22 with real
work behind it — Atlas installed from nothing twice, 45 migrations became one
baseline, three graded Tasks produced four PRs — but it left seven things
unfinished and marked one task `done` with its own checkbox deliberately
unticked. This board closes them, then writes the verdict.

Opened 2026-09-21 on the Owner's ruling. Authoring plan:
`~/.claude/plans/with-in-this-folder-elegant-rocket.md`. Branch
`campaign/confidence-close` off `main`.

Predecessor: [`2026-09-20-fresh-install-regression`](../2026-09-20-fresh-install-regression/index.md).
Its findings are `F-001`…`F-022`; this board's are `G-001`…, a fresh series.

## Board

| # | Task | Scope | Status |
|---|---|---|---|
| 1 | [Baseline — re-run every gate, record the numbers](task-01-baseline.md) | infra | done — gate is **green** |
| 2 | [Leftover-name sweep round 2](task-02-name-sweep-round-2.md) | api · shared · web · docs | done |
| 3 | [`.strict()` on `UpdateExternalNotificationSchema`](task-03-strict-external-notification.md) | shared | done |
| 4 | [Machine-verify the reviewer checklist gates](task-04-machine-verify-checklists.md) | api | done — ADR 0020 |
| 5 | [`@atlas/api` coverage to 95 on all four metrics](task-05-api-coverage-95.md) | api | todo |
| 6 | [`@atlas/web` coverage to 95 on all four metrics](task-06-web-coverage-95.md) | web | todo |
| 7 | [Recapture the twelve stale guide screenshots](task-07-guide-screenshots.md) | docs | todo |
| 8 | [Execute Jira chain X-8 and the two partial chains](task-08-jira-x8.md) | api · web | todo |
| 9 | [Security re-audit — confirm 0 advisories still holds](task-09-security-reaudit.md) | infra | todo |
| 10 | [Final regression and the written confidence verdict](task-10-final-verdict.md) | all | todo |

Row numbers are permanent. A row's status and its task file's `**Status:**`
line flip in the same commit. Checkboxes live in the task files, never here.

## Why

The predecessor's own closing section is unusually honest about what it did not
finish, and this board exists because of that honesty rather than in spite of
it. Seven gaps survived it:

- **A leftover the ruling missed.** D-3 declared a former employer's name
  absent after searching for it spelled out. What was actually in the tree was
  its abbreviated GitHub org slug paired with the name of its internal commit
  bot — nine hits across four files, two of them comments in shipping API
  source naming that company's internal playbook as Atlas's design rationale.
  `sspartorg/atlas` is a **public** repository, which is why the strings
  themselves are not reproduced anywhere on this board.
- **The coverage bar moved instead of the coverage.** ADR 0009's floors were
  rebaselined down to measured values, so the gate goes green at
  `api 94.81 / 93.77 / 94.55 / 86.63` and `web 95.40 / 94.14 / 91.58 / 90.53`.
  The Owner's bar is 95 on all four.
- **Nobody knows the gate's current state.** It was red at close; PRs #12 and
  #13 claim the fix; it has not been run since #15 merged.
- **F-012 was patched, not closed.** Reviewer checklists were populated, but
  results are still self-reported — no script exit code is ever consulted.
- Twelve guide screenshots are stale, Jira chain X-8 was never executed, and
  `UpdateExternalNotificationSchema` still answers an unrecognised body with 200.

## Owner rulings

This board's law. Each was ruled before authoring began.

| # | Ruling |
|---|---|
| E-1 | Close the gaps. **No factory reset and no full page re-walk** — the 2026-09-20 record stands for the install, onboarding, project-setup and sample-Task steps. |
| E-2 | The coverage bar is **95 on all four metrics** for `api` and `web`. Not lines-only, not a ratcheted floor. |
| E-3 | Re-verification is **machine gates plus spot-checks of the riskiest "fixed" claims**, not a browser re-walk. |
| E-4 | Both previously Owner-gated items are approved: `.strict()` in `packages/shared` (an explicit hard-rule-1 waiver, and the stated reason is F-019) **and** machine-verified checklist gates. |
| E-5 | Disclosure cleanup is **working tree plus doc redaction. No history rewrite.** Old commits stay publicly readable; `main` is not force-pushed. The residue is named in the verdict, not silently accepted. |
| E-6 | `sspart.org@gmail.com` is the real support contact. It stays in `HelpAboutTab.tsx` and as the credential-modal placeholder. |
| E-7 | X-8 runs against a **scratch project on the Owner's own Jira**, scoped by one dedicated label. The site and key are confirmed with the Owner before any write. |
| E-8 | **Atlas runs the verification gate itself.** Ruled 2026-09-21 after task-01 found that G-004's stated fix does not exist — nothing ever executes the guardrail scripts, so there is no exit code to consult. After an agent step reports `done`, Atlas runs the project's own typecheck/lint/test gate in the worktree and routes on **that** exit code; the agent's self-report becomes advisory. No schema change and no parsing of checklist labels. The gate runs on **steps whose flags are `push_code` or `raises_pr`** — where a wrong "green" has consequences — and not on steps that never touched code. |

## Standing constraints

Each names the gate it would break. These carry over from the predecessor
unchanged except where a ruling above overrides them.

- **`packages/shared` is edited only under E-4**, and only the two things E-4
  names. Any other change there stops and asks (AGENTS.md hard rule 1).
- **Status logic stays in `packages/shared/src/status-machine/`** (hard rule 2).
- **API responses match `@atlas/shared` types exactly**, snake_case throughout
  (hard rule 4).
- **No audit or forensic artifact is committed** (hard rule 6). `findings.md`
  carries prose plus `file:line` evidence. Screenshots stay out of git except
  `docs/guide/images/`, which is the one tracked image path.
- **Migrations are append-only.** The baseline is not reopened; task 4 adds no
  schema. Any new DDL is `004_*.ts`.
- **`.agents/` is updated in the same change** as any behaviour it documents.
  Task 4 changes agent routing and updates `.agents/` itself — there is no
  backstop task on this board.
- **Coverage floors ratchet one way.** A task that deletes a test without
  replacing the coverage breaks `pnpm -w run gate`.
- **Commits follow `<type>(<scope>): <summary>`**, summary ≤ 60 chars and
  imperative. Never `--no-verify`, never `--amend`.

## Gates

The campaign closes only when all of these are green and pasted into
[task-10](task-10-final-verdict.md):

`pnpm -w run gate` · `pnpm e2e` · `pnpm -F @atlas/api test` against a fresh
`atlas_test` · `pnpm audit` at 0 advisories · `pnpm -r test:coverage` showing
`api` and `web` both ≥ 95 on lines, statements, functions and branches · `rg -i`
returning 0 hits for each retired name outside this campaign's own audit trail ·
task 4's mutation proof failing when the self-report path is restored.

## Out of scope

A factory reset, a full browser re-walk, git-history rewriting, multi-user auth,
hosted deployment, Windows parity testing of the PowerShell setup path, a STRIDE
pass, an SBOM, and any fix whose blast radius exceeds the surface it was found
on. Those get their own campaign.
