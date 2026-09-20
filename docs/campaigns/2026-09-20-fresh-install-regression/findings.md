# Findings register

Everything the walk finds lands here. Nothing is fixed inline (ruling D-9) —
fixes happen in [task-14](task-14-fix-batch-p0-p1.md) and
[task-15](task-15-fix-batch-p2-p3.md), severity-ordered.

**Ten rows as of 2026-09-20.** F-001 to F-005 were pre-filed while authoring
[`checklists/per-page.md`](checklists/per-page.md), by reading code rather than
by using the app — recorded so the walk confirms them rather than rediscovering
them. **F-001 is now confirmed empirically** in
[task-03](task-03-first-boot-onboarding.md). F-006 was found during that same
first-boot pass, and F-007 to F-010 during task-06's project setup. F-002 to
F-005 remain unconfirmed at runtime; their pages are walked in tasks 10 and 11.

---

## Before filing anything

1. **Check `.agents/coming-soon.md`.** Eleven controls toast or sit disabled on
   purpose. A stub is not a bug. If a control is listed there, it is not a
   finding — and if it is listed there but the page doc does not mention it,
   *that* is a docs finding.
2. **Check the page doc.** If `.agents/pages/<NN-slug>.md` says the behaviour
   you are seeing is intended, believe the doc until the code disagrees with
   it. If doc and code disagree, file it as a `P3 · docs` finding naming both
   lines.
3. **Reproduce once more before writing.** A finding with a repro nobody else
   can run is noise.

## Severity rubric

Severity is about consequence, not about how annoying it was to hit.

| | Meaning | Examples |
|---|---|---|
| **P0** | Data loss, credential exposure, or a destructive action firing on the wrong target | a standalone terminal stop deleting the Owner's real repo; a token appearing in an SSE line or an error page; `purge` deleting outside `workspace_path` |
| **P1** | A core flow cannot complete, or completes wrongly and silently | a workflow run that never provisions a worktree; a PR opened against the wrong repo; a saved secret that never reads back; a status transition the machine forbids being accepted |
| **P2** | A flow completes but a surface lies about it | a badge count disagreeing with its page; a list missing something just created until a hard reload; an author rendering as the literal "Agent"; an empty state where data exists |
| **P3** | Cosmetic, copy, or documentation drift | a stale `.agents/` page doc; a misleading label; a missing loading state |

A finding that is P2 on one page and P1 in a chain takes the higher severity —
consequence wins.

## Row schema

| Field | Rule |
|---|---|
| `id` | `F-001`, allocated in order, **never reused or renumbered** |
| `sev` | P0–P3 per the rubric above |
| `where` | the checklist section id (`B3`, `X-9`) plus the route |
| `symptom` | what a user sees, one sentence, indicative mood |
| `evidence` | `file:line`, a pasted terminal tail in a fence, or a DB query and its result. **Not** "see screenshot" — screenshots stay local and are not committed (AGENTS.md hard rule 6) |
| `class` | which of the six check classes caught it, or `chain` for a cross-cutting one |
| `status` | `open` → `fixed in <sha>` → `verified in <task>`, or `wontfix — <ruling>` |

## Register

| id | sev | where | symptom | evidence | class | status |
|---|---|---|---|---|---|---|
| F-001 | P1 | A1 · `/onboarding` | The accent-colour swatch picker is live UI that writes nowhere. The Owner picks a colour during onboarding and it is silently discarded. | `Onboarding.tsx:249-263,382` renders the picker; `api/api.ts:299-300` sends only `{owner_name, workspace_path}`; `services/settings.ts:186-194` writes `owner_name`/`workspace_path`/`onboarding_complete` only. `.agents/pages/00-onboarding.md:43,53` and `.agents/functional-checklist.md:69` both assert it persists | 1 round-trip | open |
| F-002 | P1 | C6 · `/agents` | Add Agent fails silently when the seeded model is not in the registry — no toast, no error, the dialog just sits. | `Agents.tsx:242-262` is `try { await api.agents.create(...) } finally { setSaving(false) }` with **no catch**, fired as `onClick={() => void handleAddAgent()}` at `:606`; the form hardcodes `model: 'claude-sonnet-4-6'` at `:128,:254` rather than reading the registry. `assertModelInRegistry` throws at `services/agents.ts:252` and the 400 becomes an unhandled rejection. `MarketplaceAgentDetail.tsx:81-93` has the catch; `/agents` does not — same shape as the marketplace-install bug of 2026-09-12 | 6 error, X2 | open |
| F-003 | P2 | C7 · `/agents/:id` | Prompt version history attributes every edit to the literal string `'Owner'` rather than to a resolved identity. | `services/agents.ts:291,354,419` write `'Owner'` into `agent_prompt_versions.edited_by` on create, prompt update and revert | 2 attribution, X3 | open |
| F-004 | P2 | D10 · `/notifications` | The sidenav notifications badge can exceed what the In-App Feed will ever display, with no label explaining the gap. | badge counts every unread row with no staleness join (`services/counts.ts:136-140`); the feed drops stale `needs_you` / `agent_completed` rows (`services/notifications.ts:69-78`) | 5 cross-page, X4 | open |
| F-005 | P2 | D10 · `/notifications` | A notification referencing a deleted agent renders as the literal `Atlas`, indistinguishable from a genuine system row. | `InAppFeedTabContent.tsx:169` is `agent?.name ?? 'Atlas'` | 2 attribution, X3 | open |
| F-006 | P3 | A1 · `/onboarding` | A rejected submit leaves its error on screen while the user fixes the input; the stale message only clears on the next submit. | `Onboarding.tsx:202-211` `handleWorkspacePathChange` clears `errors.workspacePath` but not `submitError`; `submitError` is reset only inside `handleFinish` at `:233`. Reproduced 2026-09-20: submitted `relative/path`, got "Workspace folder must be an absolute path: relative/path", then replaced the field with a valid absolute path — the error persisted through a 2s wait. | 6 error | open |
| F-007 | P3 | A2/A4 · `/` and `/projects` | Both empty states tell the Owner "No credentials yet?" unconditionally, including when credentials exist. The Projects copy also says to add a "Personal Access Token" when the saved credential is a GitHub App. | `ProjectsEmptyState.tsx:56` and `DashboardEmptyState.tsx:80` render the Alert with no credential check and receive no credentials prop. The same Dashboard component **does** condition its agents hint on a `noAgents` prop, so the pattern exists and was simply not applied here. Reproduced 2026-09-20 after a full page load with one saved App credential; the New Project modal on the same page correctly reported "Git credential · 1 saved". | 5 cross-page | open |
| F-008 | P3 | A5 · `/projects/:id?tab=repos` | The Add repo modal subtitle reads "Tasks in this project can then work on it next to the **primary repo**". ADR 0018 removed the primary repo. | `pages/project/AddRepoDialog.tsx` subtitle. It contradicts the Repos tab copy rendered directly behind it — "A Task works on the repos it picks; each gets its own checkout on the Task's branch" — and contradicts `docs/adr/0018-repos-without-a-primary.md`. | 2 attribution | open |
| F-009 | P3 | A5 · `/projects/:id?tab=repos` | A repo added after project creation clones into `<project-slug>-<repo-name>`, so a repo whose name already starts with the project name stutters on disk. | `routes/projects.ts:408` builds `join(workspace_path, slug(project.name) + '-' + body.name)`; project-create at `:126` uses `join(workspace_path, body.project_name)`. The two repos of one project therefore follow different naming schemes. Observed 2026-09-20: `~/Work/workspace/atlas-sdlc-sandbox` and `~/Work/workspace/atlas-sdlc-sandbox-atlas-sdlc-sandbox-web`. Functionally harmless — `dirname(git_path)` is identical for both, so worktrees co-locate correctly. | 1 round-trip | open |
| F-010 | P2 | C9 · `/agents/marketplace` | Installing a workflow template installs agents whose default CLI is absent from the machine, with no warning. The failure surfaces only mid-run. | Creating the `delivery` workflow installed 10 agents, 6 of them `cli = copilot`: Coder, Code Reviewer, Automation Engineer, Automation Reviewer (plus their reviewers). `which copilot` returns not-found, and `pnpm doctor` had already reported `[skip] copilot: not found (optional)` at boot. `Build sub-task` runs `agent-coder` and `agent-code-reviewer`, so the first real Task would have died at the build step. Nothing in the install path consults the prerequisite check. | 3 list membership, 6 error | open |

---

## Carried in from prior work

Not findings — these are known, already documented, and listed so nobody
files them again as discoveries.

| What | Where it is recorded | Handled by |
|---|---|---|
| `items.repo_ids` has no GIN index despite being a first-class query path since migration 045 | `services/project-repos.ts:161` | [task-16](task-16-perf-and-indexes.md) |
| Six foreign keys carry no leading index, `workflows.project_id` being the worst | `services/workflows.ts:194` | [task-16](task-16-perf-and-indexes.md) |
| `docs/setup-script-contract.md` documents setup scripts as per-project; migration 045 / ADR 0018 made them per-repo | `docs/setup-script-contract.md:31-56` vs `packages/shared/src/types/index.ts:313` | [task-20](task-20-docs-guide-refresh.md) |
| The user guide covers 11 of 34 pages and predates Tasks, Workflows, Terminals, Jira, Credentials and multi-repo projects | `docs/guide/README.md` | [task-20](task-20-docs-guide-refresh.md) |
| Seventeen `.agents/` page docs describe behaviour the code does not have — including three that would make a tester file a false bug, and four `coming-soon.md` rows for controls that were removed rather than deferred | tabulated in [task-21](task-21-agents-sync-and-adrs.md) with `file:line` for each | [task-21](task-21-agents-sync-and-adrs.md) |
| ~209 e2e tests skip by default behind `PERF` / `FORENSIC` / `FUNCTIONAL` / `STATE_TRANSITIONS` flags — these are gates, not failures | `playwright.config.ts`, `playwright.forensic.config.ts` | [task-22](task-22-final-regression-and-close.md) |
| `e2e/visual/` has no snapshot CI wired; it is kept deliberately | `e2e/visual/README.md` | out of scope |
