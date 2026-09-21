# confidence-close — findings

Fresh series. The predecessor's findings are `F-001`…`F-022` in
[`../2026-09-20-fresh-install-regression/findings.md`](../2026-09-20-fresh-install-regression/findings.md)
and are never renumbered or reused here.

**Eight rows as of 2026-09-21.** G-001 to G-007 were pre-filed from the audit
that opened this board — each is a gap the predecessor left, with its evidence
already gathered. G-008 was found while inventorying the route table and is the
only genuinely new defect so far.

## Conventions

| Field | Meaning |
|---|---|
| `id` | `G-001`, allocated in order, **never reused or renumbered** |
| severity | `P0` disclosure or data loss · `P1` broken guarantee · `P2` wrong behaviour · `P3` cosmetic or documentation |
| where | the surface, as the route or the module |
| evidence | `file:line`, a measured number, or a pasted command output — never "I observed" |
| status | `open` · `fixed` · `withdrawn`, with the task that closed it |

A finding is only `fixed` once a regression test exists that fails when the fix
is reverted. "Documented" is a valid fix for a contract gap, and says so.

## Rows

| id | sev | where | finding | evidence | status |
|---|---|---|---|---|---|
| G-001 | **P0** | repo-wide · public | Another company's org prefix and internal bot name ship in Atlas source, and two of the hits are comments citing that company's internal playbook as the design rationale for Atlas's git-credential behaviour. The predecessor's ruling D-3 declared `insightsoftware` absent after searching only the spelled-out name; `isw` is the abbreviation. | 9 hits across 4 files. Shipping source: `packages/api/src/services/git-credentials.ts:31` ("same shape isw-CDM-Next uses for `cdmnext-claude-bot`"), `packages/api/src/services/worktree-orchestrator.ts:1041` ("the isw-CDM-Next/cdmnext-claude-bot playbook"). Fixtures: `packages/api/src/services/github-app-tokens.test.ts:123,126,141`, `packages/api/src/services/credentials.test.ts:315,317`, and `packages/shared/src/schemas/schemas.test.ts:433,435` — the last inside protected `shared`. `gh repo view --json visibility` → `PUBLIC`. Present in git history: `git log -S "isw-CDM-Next" --all` → 2 commits. | open — task-02 |
| G-002 | P2 | docs · tracked campaign files | Third-party infrastructure names, a colleague's name and the Owner's absolute home paths are published in tracked campaign documentation on a public repo. Mundane individually; collectively they are an inventory of someone else's estate. | `dhequest1-*`, `dhequest2-*`, `dhequest-backup-*`, `dhequest-platform`, `neel-postgres`, `shopping-site_*` across `2026-09-20-*/index.md:76`, `task-02-factory-reset.md:130-131`, `checklists/reset-inventory.md:110-121`. `Sairam` at `task-03-first-boot-onboarding.md:157,161`. `/Users/sunnysabhanam/…` at `task-13:121`, `task-06:134,135`, `task-03:158,161`. `C:\Users\sspart\.claude\plans\…` cited as a source at `docs/adr/0011-ipad-viewport-and-three-viewport-visual-matrix.md:10`. | open — task-02 |
| G-003 | P2 | `api` · `web` coverage | The coverage bar was lowered to the measured value rather than the measurement raised to the bar, so `pnpm -w run gate` passes below the Owner's stated 95%. | ADR 0009's amended table: `@atlas/api` 94.81 lines / 93.77 stmts / 94.55 funcs / **86.63 branches**; `@atlas/web` 95.40 lines / 94.14 stmts / **91.58 branches** / **90.53 funcs**. Floors in `packages/api/vitest.config.ts:436` are 94.3 / 93.2 / 94 / 86.1 — measured-minus-jitter. `shared` and `mcp` are genuinely 100. | open — tasks 05, 06 |
| G-004 | **P1** | `api` · agent outcome routing | Reviewer verification gates remain unenforced in principle. The predecessor populated the empty `checklists.json` files, which closed the symptom, but the router still reads the agent's own claim — so an agent that asserts a red suite is green is still believed. **Amended 2026-09-21:** the original remedy was unimplementable, see below. | `packages/api/src/services/agent-runner-outcome-routing.ts:72-88`: an empty required checklist returns `apply_on_pass`, and `if (item.passed)` trusts the `atlas-outcome` block. Predecessor F-012 records the consequence: ATL-5 shipped two PRs with red suites while every reviewer reported green. **The stated fix — "consult the guardrail script's exit code" — does not exist to consult.** `services/constitution-assembler.ts:84-90` writes each script into the worktree at `.atlas/scripts/bash/check-<id>.sh` mode 0755 and stops; Atlas never executes one. And `agent_checklists` is `(id, agent_id, label, sort_order, required)` — no `script_id`, no args column. The only link from an item to its script is prose inside the label: `"… ran check-coder-tests-green.sh <itemId> --run-tests"`. Closing this needs a new execution stage, not a rewiring — **ruling E-8**. | open — task-04 |
| G-005 | P3 | `docs/guide` | Twelve of the fifteen user-guide screenshots predate the factory reset and show the retired sandbox project under its old issue-key prefix. A thirteenth is orphaned — present in git, referenced nowhere. | `doc-01`…`doc-12` in `docs/guide/images/`; only `doc-13`, `doc-14`, `doc-15` are post-reset captures. `doc-02-dashboard-empty.png` has no `![…]` reference in `docs/guide/README.md`. The predecessor's task-20 states this at `:162-166` and leaves its own screenshot checkbox unticked while the board row reads `done`. Separately, `README.md:463-464` calls a repo directory a "Confluence page". | open — task-07 |
| G-006 | P3 | `api` · `web` · Jira bridge | Cross-dependency chain X-8 has never been executed against a live Jira site, and two further chains are only partial. | `2026-09-20-*/task-13-cross-dependency-sweep.md:108` — `blocked — no Jira site configured. GET /api/integrations/jira returns enabled:false, api_token_set:false`. The bridge is correctly *shaped* per ADR 0017/0018; nothing has ever been synced through it. | open — task-08 |
| G-007 | P3 | `PATCH /api/settings/external-notification` | A payload whose field names are all unrecognised returns **200 OK having written nothing**, teaching an MCP-driven agent that its write succeeded. | `UpdateExternalNotificationSchema` at `packages/shared/src/schemas/index.ts:634` declares four fields, every one `.optional()`, and Zod strips unknown keys — so `{provider, token, chat_id}` parses to `{}`. The opposite pattern already ships two routes over: `PATCH /api/projects/:id/repos/:repoId` is strict and answers `{"error":"Unrecognized key: …","kind":"validation_error"}`. Carried over from predecessor F-019, which was marked fixed but only documented. | open — task-03 |
| G-008 | P3 | global keyboard shortcuts | The `g`-then-`d` "go to dashboard" shortcut navigates to `/dashboard`, which is not a declared route. It falls through to the `*` catch-all and only *appears* to work because the catch-all redirects to `/`. Any future non-redirecting catch-all silently breaks it. | `packages/web/src/hooks/useGlobalShortcuts.ts:10` maps `d` → `/dashboard`. `packages/web/src/App.tsx` declares `/` but no `/dashboard`; the `*` route is `<Navigate to="/" replace />`. Found while inventorying the route table, not by a failing test — no spec asserts the destination. | open — task-06 |

## Not findings

Recorded so they are not re-filed by the next reader.

- **`accent_color` on `OnboardingSchema`.** The predecessor's closing note lists
  this as still needing an Owner ruling. It does not — `Onboarding.tsx:255`
  sends it through `api.settings.updateProfile`, the same endpoint Settings
  uses, so the schema never needed the field. Closed, not open.
- **`sspart` / `sspartorg` / `sspart.org@gmail.com`.** This product's own org
  and its real support contact. Ruling E-6.
- **`CER` at `packages/api/src/services/_keys.test.ts:26`.** A deliberate WHY
  comment recording that the 2026-09-20 rename briefly collapsed two distinct
  prefixes. Removing it invites the same collision again.
- **`acme.atlassian.net`.** A proper placeholder, used consistently across every
  Jira fixture. It is the convention this board's fixtures should match.
- **"Linoes".** Genuinely absent. Searched across the working tree, every
  gitignored directory, and every blob in `git rev-list --all`. The only hits
  in the repo are the predecessor writing down that it found none.
