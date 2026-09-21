# 2026-09-22 — Fresh-install walkthrough

**Status:** walkthrough complete; fixes in the working tree, nothing pushed.
**Scope:** factory reset → first boot → full Owner walkthrough → one shipped PR.

Run overnight while the Owner slept, on the Owner's instruction to "fix all open
issues and complete the full walk through and keep the app ready for my manual
walk through tomorrow."

---

## What was reset

Followed [`2026-09-20-fresh-install-regression/task-02`](../2026-09-20-fresh-install-regression/task-02-factory-reset.md)
literally; it remains the authority.

| | |
|---|---|
| Processes | 4 stale `pnpm dev` stacks stopped. The 68 unrelated processes on this host were untouched. |
| Docker | `atlas-postgres`, `atlas-pg`, `atlas_default` removed **by name**. Before/after diffs: exactly 3 resources gone, 10 other containers and 10 other volumes intact, image cache unchanged. No prune of any kind. |
| Workspace | Cleared to `bots-info` only. PEM sha256 `3d9dab45…b34aa`, mode 0600 — matches the hash recorded on 2026-09-20. |
| Key | `workspace.key` deleted **after** the volume was confirmed gone (reversed, that strands ciphertext). Regenerated on the first credential. |
| First boot | Container created from nothing; 3 migrations applied as batch 1 (proves a new DB, not a replay); 16 catalog agents seeded, 0 installed. |

## What was walked

Onboarding → GitHub App credential → project → 2 repos → 10 agents → Delivery
workflow → Task ATL-1 → 2 escalations answered → build → QA → automation → PR.

- **PR shipped:** [sspartorg/atlas-sdlc-sandbox#17](https://github.com/sspartorg/atlas-sdlc-sandbox/pull/17),
  author `app/sspart-bot`, branch `atlas/wf/ATL-1`, +336 −3 across 6 files,
  assignee `sspartorg`, body carries `Requested-By: @sspartorg`.
- **Cost:** $5.38 across 13 agent runs.
- One Task = one branch = one PR held (ADR 0015). Sub-task ATL-2 got a `[QA]`
  twin ATL-3 linked by `tested_by`, as designed.

**Security invariants verified.** `GET /api/credentials` returns
`token_encrypted: null` and exposes the private key only as a
`has_app_private_key` boolean; both cloned `.git/config` files contain zero
credential-shaped lines; no orphaned `atlas-setup-*` or git-config temp dirs;
no token in any remote URL. No secret was typed at any point — the GitHub App
form takes a folder path and Atlas reads `app-config.json` + the `.pem` itself.

**Empty-state sweep.** 96 read-only walker scans (light + dark): **0**
button/link accessibility problems. Every parameterless `GET` endpoint returns
2xx against an empty DB — no fresh-install 500s. The only non-2xx are correct:
`/api/fs/*` 401s are the MCP token gate, `folder-origin` 400s on a missing param.

---

## Findings

### F-1 · Delivery workflow halts on every Task out of the box — **fixed**

A `block` guard-rail (`seed-net-no-test-execution`) banned *every* test runner
and said "verify with typecheck + lint only". Three catalog agents nevertheless
carry a **required** checklist row that can only be satisfied by executing tests:

| Agent | Row |
|---|---|
| `agent-coder` | "Project test suite clean" |
| `agent-code-reviewer` | "Full project test suite green — ran `check-coder-tests-green.sh <itemId> --run-tests`" |
| `agent-automation-reviewer` | "Automated tests execute green, not merely parse" |

The two defaults are mutually exclusive, so on a fresh install every dev
sub-task and every code review halts with `checklist_failed` and escalates —
the autonomous workflow stops on every Task. **Observed live:** ATL-2 parked at
the Coder, then again at the Code Reviewer, which correctly cited the same
conflict on its own row 21.

Decisive evidence that the rule, not the checklists, was wrong:
**ADR 0020** (accepted 2026-09-21) states the guard-rail scripts "keep their
existing role as material staged into the worktree **for the agent to run**".
The blanket ban made an accepted ADR's own mechanism impossible.

**Fix:** migration `005_guardrail_tests_in_worktree.ts` narrows the rule to
"only inside your own item worktree". Severity stays `block` — it still blocks
running the suite against the main checkout, another item's worktree or a
deployed environment. Guarded on the original text, so an Owner who reworded
the rule keeps their version. Round-tripped `up`/`down` against the live DB.

### F-2 · Agents could not use any current model — **fixed**

The seeded `cli_models` catalog was captured 2026-06-02 and stopped at Opus 4.7.
This is not cosmetic: `agents_cli_model_fk` is a composite FK
`agents (cli, model) → cli_models (cli, model_name)`, so a model absent from the
table **cannot be assigned to an agent at all**. Every agent was pinned to a
superseded generation with no path forward from the UI.

**Fix:** migration `004_cli_models_claude_5.ts` adds `claude-opus-5`,
`claude-opus-5[1m]`, `claude-sonnet-5`, `claude-fable-5-1` and sorts them above
the older rows, which are kept. Model strings were checked against the CLI's own
`--help`, not recalled. `down()` moves any agent back to `claude-opus-4-7`
*before* deleting, because the FK is `ON DELETE RESTRICT`; the round-trip was
proven against the live DB, not assumed.

### F-3 · A freshly cloned project stayed invisible until reload — **fixed**

`useProjectsPaged` keyed its cache `['projects-paged', …]`, a **sibling root** of
`['projects']`. TanStack prefix-matching never matches the two, so every
`invalidateQueries(['projects'])` silently missed the list the page actually
renders. **6 of 10 call sites** were affected, including both clone paths.
`DeleteProjectModal.tsx` even carried a comment admitting someone had hit this
and patched their own call site.

**Fix:** the paged key now nests under `['projects']`, so one invalidation
reaches both lists — for every present and future caller. Four now-redundant
invalidations deleted. The regression test that had encoded the workaround as
the requirement was rewritten to assert against the exported key, so it cannot
pass vacuously.

### F-4 · Icons painted as raw text on cold load — **fixed**

The Material Symbols stylesheet was injected without a `display` parameter, so
the face resolved to `font-display: auto` and the sidenav rendered
"dashboard", "sticky_note_2", "smart_toy" over the real labels during the swap
period. The ligature text *is* the glyph — the same root cause
`icon-accessibility.test.ts` already documents for screen readers.

**Fix:** `&display=block` (`packages/web/src/main.tsx`). Regression test added
and **proved to fail when reverted**.

### F-5 · `GET /api/run` always reported a null outcome — **fixed**

The list route never SELECTed the four `outcome_*` columns, while `asAgentRun`
maps them — so `IAgentRun` promised a field the API always returned as `null`,
and a run that ended `asked_question` was indistinguishable from one with no
outcome. The detail route carries a comment showing this exact bug was fixed
*there* on 2026-09-12; the list route was missed.

**Fix:** `outcome_kind` + `outcome_summary` added to the list projection.
`outcome_reason` stays out — it can be long and a list does not render it.

### F-6 · Sidenav lit the wrong section on sub-task routes — **fixed**

`activeKey` fell back to `?? 'dashboard'`, so `/sub-tasks/:id` — the one
in-shell route with no nav row — highlighted **Dashboard** while the Owner was
three levels inside Tasks. **Fix:** map `/sub-tasks` to the Tasks key. Also
added `aria-current="page"`, which the active row never had, so a screen reader
can announce the section. Tests assert via `aria-current`, not mere presence;
the old tests could not fail.

### F-7 · `AGENTS.md` told agents to delete a working feature — **fixed**

The "No invented data" rule listed `priority` as forbidden invented data. But
`priority` is real: `IssuePriority` in `@atlas/shared` (`types/index.ts:149`),
validated by the Zod item schemas, persisted as `items.priority` behind a CHECK
constraint, and rendered by 7 components. An agent obeying the rule would delete
a shipped feature. **Fix:** corrected, with the counter-evidence inline.

### F-8 · `.agents` drift — **fixed**

- `20-credentials.md` described an "App password (disabled)" kind-picker option
  that **exists nowhere in `CredentialModal.tsx`**; the real third option is
  GitHub App, and it is enabled. Documented the App form and that it takes no
  secret.
- `coming-soon.md` carried an "App password credential" row citing
  `CredentialModal.tsx:307-335` — fictional. Removed; the SSH row's line
  reference corrected.
- `routes-map.md` still described a "Check expiries" button and a "Verify now"
  menu item that the 2026-09-20 campaign had already deleted from the page doc.
- The migrations index was missing `003` entirely; `003`, `004`, `005` now listed.

### F-9 · Agent-name acronyms mangled before install — **fixed**

`agentLabel` title-cases each word, so an uninstalled `agent-po-writer` rendered
"Po Writer" in the New-workflow dialog beside a detail page saying "PO Writer".
Visible on the first-run path. **Fix:** acronym-aware capitalisation (`po`,
`qa`, `ai` — the only ones in catalog ids), with a test.

---

## Open — needs an Owner decision

### O-1 · Owner attribution reaches only Atlas's own commits

Of the 7 commits on `atlas/wf/ATL-1`, **1** carries
`Co-Authored-By: sspart <sspart.org@gmail.com>` — Atlas's own `chore(atlas)`
housekeeping commit. The 6 commits that do the actual work (spec, tests, feat,
QA plan) carry `Co-Authored-By: Claude <noreply@anthropic.com>`, which the
catalog prompts hardcode.

`check-commit-discipline.sh` cannot catch it: it greps for any
`Co-Authored-By:`, so Claude's trailer satisfies it.

**Ruled out, with evidence.**

1. *The hook mechanism is broken* — no. An isolated repo with an
   Atlas-shaped config fires `prepare-commit-msg` and appends the trailer.
2. *The agent CLI bypasses hooks* — no. Running the `claude` CLI itself against
   an Atlas-identical `GIT_CONFIG_GLOBAL`, in a scratch repo, produced a commit
   carrying **both** `Co-Authored-By: Claude` and
   `Co-Authored-By: sspart <sspart.org@gmail.com>`, and the instrumented hook
   logged that it ran. So an agent-CLI commit under this config does get the
   trailer.
3. *The repo overrides `core.hooksPath`* — no. The sandbox clone has no
   `.husky`, no local `core.hooksPath` and no local `user.name`/`user.email`.
4. *The agent never received the config* — no. The host `~/.gitconfig` carries
   the Owner's own developer identity, not the bot's, yet every agent commit is
   authored `sspart-bot[bot]`. That identity can only come from the `[user]` block in
   Atlas's per-run config, which is the same file that sets `core.hooksPath`.
   `dev.log` shows no "could not prepare git auth" warning.

**What this leaves.** The hook fires in a faithful reproduction but not in a
real run, and the reason is not yet identified. Two observations worth carrying
into the next attempt: both of Atlas's own commit paths deliberately clobber the
hook with `-c core.hooksPath=.husky/_` and use an explicit `--trailer` instead
(`workflow-engine.ts:736`, `cli-sessions.ts:1063-1070`) — so the hook installed
by `buildGitAuth` has no effect on any Atlas-driven commit and exists solely for
agent commits; and commit `df68133` carries two different Claude trailers, which
means at least one message was rewritten after its first write.

**Why nothing was shipped.** The Owner picked "make the hook authoritative in
the worktree". The evidence no longer supports that as the cause, and the fix
carries a real regression: a worktree-local `core.hooksPath` disables the
project's own hooks, including pre-commit secret scanning. Shipping an
unverified change to every commit path overnight was the wrong trade.

**Next step.** Instrument `writePrepareCommitMsgHook` to append to a log on
every invocation, then run one Coder step and read it. That distinguishes "the
hook never ran" from "it ran and its output was later rewritten" in a single
run. It was not done here because it writes a second Task into the database the
Owner asked to have clean for a manual walkthrough.

---

## Verification

- `pnpm -r typecheck` — clean, 4 packages.
- `pnpm -r lint` — 0 errors (76 pre-existing `any` warnings, none in changed files).
- API suite — 155 files, 2718 tests, all passing (includes migrations 004/005).
- Web suite — 336 files, 4364 tests, all passing.
- Every new test was checked to **fail without its fix**, not merely to pass.

## State left behind

Dev stack running: web :4100, API :4101, MCP :4500, Postgres :5500.
Owner `sspart`, 1 credential, 1 project / 2 repos, 10 agents, 3 workflows,
ATL-1 + ATL-2 + ATL-3 all `in_review` behind PR #17 — ready to walk.

**Nothing was pushed.** `sspartorg/atlas` is public and `main` is protected, and
a push could not be approved while the Owner slept. All fixes sit on the local
branch `walkthrough/2026-09-22-fixes`.
