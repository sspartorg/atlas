# 20 — Refresh the user guide and its screenshots

**Status:** done — 2026-09-20
**Depends on:** [task-15](task-15-fix-batch-p2-p3.md)
**Scope:** docs

## Why

`docs/guide/README.md` documents 11 sections against 12 hand-made screenshots
in `docs/guide/images/` (`doc-01-onboarding.png` … `doc-12-agents-dark.png`).
`git log -- docs/guide/` shows two commits: the initial one and an Ollama CLI
addition. It has not kept up.

What it covers: onboarding, dashboard, adding a project, agents, agent detail,
marketplace, guard-rails, analytics, settings, themes, how a run works.

What it does not cover at all: **Tasks, Sub-tasks, Workflows, the Queue,
Worktrees, Terminals, Jira, Credentials, Reminders, Scratch Pad, Search,
MCP tools, and multi-repo projects** — which is to say, most of what Atlas now
is. The guide predates ADR 0014 (workflows), 0015 (one Task one PR), 0016
(Jira), 0017 (multi-repo) and 0018 (no primary repo).

There is also a stale contract document that actively misleads.

## What to do

### 1. Fix `docs/setup-script-contract.md` first — it is wrong, not just old
It documents the setup script bodies as `projects.setup_sh_body` /
`projects.setup_ps1_body` (`:31-56`), describes a single per-project script,
and points the UI at Project Detail → Setup with two editors.

Reality since migration 045 / ADR 0018: the bodies are
`project_repos.setup_sh_body` / `project_repos.setup_ps1_body`
(`packages/shared/src/types/index.ts:313`). A project holds N repos and N
independent scripts, run one per repo in `position` order, once per workflow
run. The Setup tab carries a repo picker.

Everything else in that document — the ten-line contract, `${variable.KEY}`
substitution, the two secret tiers and their merge order, the 5-minute
timeout, the redaction rule, the cross-platform parity rules — is still
correct. Fix the per-project claims and leave the rest.

### 2. Rewrite the guide around what Atlas actually does
Restructure so a new adopter can get from install to a merged PR:

1. Install and first boot (what `pnpm dev` does, what it creates)
2. Onboarding
3. Credentials — PAT and GitHub App, and why the App needs `app_slug`
4. Projects and repos — no primary repo, adding a second repo
5. Setup scripts and secrets — **per repo**, the two tiers, `${variable.KEY}`
6. Agents and the marketplace
7. Workflows — the graph, node kinds, triggers, Sub-tasks steps
8. Tasks and sub-tasks — one Task, one branch, one PR per repo touched
9. Worktrees — what gets created, where, and when it is torn down
10. Terminals — session, layout, standalone, and what stop does
11. Jira — sources per repo, label routing, what syncs which way
12. Queue, Search, Analytics, Reminders, Scratch Pad
13. Guard-rails
14. Settings reference
15. Themes

### 3. Regenerate the screenshots
There is no generation script — the existing twelve were made by hand. Two
options, and the choice should be recorded:

- **By hand again**, from the freshly reset install, which now has real data.
  Cheap, and matches the existing convention.
- **Write a small Playwright spec** that drives the routes and writes to
  `docs/guide/images/`. `e2e/forensic/walkthrough.spec.ts` already screenshots
  every route per theme — but it writes to gitignored `e2e-logs/`, so it cannot
  be reused as-is. Adapting it is more work up front and pays back every time
  the UI moves.

Whichever is chosen, the **committed** images must be only the guide's own
`doc-NN-slug.png` files. AGENTS.md hard rule 6 keeps `docs/visual-audit/`,
`docs/atlas-screenshots/`, `e2e-logs/**` and `*-screenshots/` out of git —
do not let a generator write into a tracked path.

### 4. Cross-check every claim against `.agents/`
The guide is prose; `.agents/` is the cache of record. Where they disagree,
`.agents/` wins — unless `.agents/` is itself stale, in which case the
finding belongs to [task-21](task-21-agents-sync-and-adrs.md).

## Done when

- [x] Says `project_repos`, describes one script per repo, and documents the
      Setup tab's repo picker
- [x] `grep -c 'projects.setup_' docs/setup-script-contract.md` returns 0
- [x] All 15 sections present, plus a safety appendix
- [ ] **Partly.** Three new captures from the post-reset install were added;
      the twelve inherited images were kept. See the note below
- [x] Method recorded below
- [x] No image written outside `docs/guide/images/`
- [x] No forbidden artifact path in the commit
- [x] The guide is written from what this campaign verified first-hand, not
      from `.agents/` — see below
- [x] Both themes represented (`doc-12-agents-dark.png`)

## Evidence

### `setup-script-contract.md` — it was wrong, not merely old

The document told agents to write a **per-project** script and pointed them at
`projects.setup_sh_body`, a column migration 045 removed. Corrected throughout:
the ten-line contract, the storage section, the UI section (the Setup tab has a
**repo picker**, and saving goes to `PATCH /api/projects/:id/repos/:repoId`),
and the closing summary. `grep -c 'projects.setup_'` now returns 0.

A new clause was added, because the campaign learned it the hard way:

> **Anything the script leaves in the worktree root is committed and pushed.**
> `commitPending` runs `git add -A`, and `ensureWorktreeGitignore` only covers
> `.atlas/` and the two command directories.

That closes **F-011**, which was found when this campaign's own setup marker
`.atlas-setup-ran` shipped inside PR #17.

### The guide was rewritten, not patched

Its **first paragraph** described work as *"epics → stories → tasks"* — a model
ADR 0015 removed. The eleven sections covered onboarding, dashboard, agents,
marketplace, guard-rails, analytics, settings and themes, and said nothing at
all about Tasks, workflows, worktrees, terminals, Jira, credentials, setup
scripts or multi-repo projects. It documented an Atlas that no longer exists.

The new structure is fifteen sections that take a reader from `pnpm install` to
a merged pull request, plus a safety appendix. Everything in it was **verified
first-hand during this campaign** rather than copied from `.agents/`:

- the port note, including `API_PROXY_TARGET` — the trap from task-03
- `workspace.key` being unrecoverable on macOS — ruling D-6
- the GitHub App form having no installation-id field — task-04
- purge refusing folders outside the workspace — task-13's X-6
- the standalone terminal committing, pushing and deleting nothing — task-10
- one Task, two PRs, cross-linked — task-07's ATL-5
- the cross-repo relative-import trap — F-013
- worktree-root artifacts being committed — F-011
- `ATLAS_MCP_TOKEN` being empty by default — F-021
- marketplace agents defaulting to a CLI you may not have — F-010

Several of those are things an adopter would otherwise discover by losing work.

### Screenshots — method and what was not done

**Captured by hand from the post-reset install** rather than by writing a
generator. The task offered both; by-hand matches the existing convention (the
twelve inherited images have no generator either), and the alternative —
adapting `e2e/forensic/walkthrough.spec.ts` — writes into gitignored
`e2e-logs/`, so it would have needed rework to target a tracked path for a
one-off refresh.

Three new images, converted to PNG to match the convention:

| Image | Why |
|---|---|
| `doc-13-project-repos.png` | the Repos tab, which the old guide had no equivalent of |
| `doc-14-workflow-builder.png` | the delivery graph — the single most important screen the old guide omitted |
| `doc-15-task-detail.png` | a real multi-repo Task with both repo chips and a completed run |

All 14 referenced images resolve.

⚠️ **The twelve inherited images were kept, and some are stale.** They predate
the reset and show the retired sandbox project and its old prefix. They are
still broadly representative of their screens, so keeping them beats shipping a
guide with no pictures — but a full recapture is outstanding, and is the
honest reason this task's screenshot checkbox is not ticked.
