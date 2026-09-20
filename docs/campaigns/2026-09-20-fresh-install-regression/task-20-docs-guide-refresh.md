# 20 — Refresh the user guide and its screenshots

**Status:** todo
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

- [ ] `docs/setup-script-contract.md` says `project_repos`, describes one
      script per repo, and its table of contents matches its body — paste the
      diff of the corrected sections
- [ ] A grep for `projects.setup_sh_body` across `docs/` returns 0
- [ ] The guide has a section for every item in the 15-point structure above
- [ ] Every screenshot in `docs/guide/images/` is regenerated from the post-
      reset install; none shows the old sandbox project or a retired prefix
- [ ] The screenshot method is recorded below, with the reason
- [ ] `git status` shows no image written outside `docs/guide/images/`
- [ ] No forbidden artifact path appears in the commit — check against
      AGENTS.md hard rule 6's list
- [ ] Every factual claim in the guide is cross-checked against `.agents/`;
      disagreements are filed, not silently resolved
- [ ] Both light and dark themes are represented

## Evidence

*(filled during execution)*

Screenshot method chosen: ____ — because ____
