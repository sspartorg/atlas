# Functional checklist

Per-route checks for **data correctness**, not rendering. The repo already has
render coverage: 35 page specs, 30 modal specs, a route-level visual walker, and
`FUNCTIONAL=1 pnpm e2e:functional`, which asserts every button has an accessible
label and every link has a real `href`. None of that asserts that what the UI
shows matches what the server stored.

That gap is where the 2026-09-12 bug report lived. All three reported bugs
rendered fine, had labelled buttons, and typechecked:

| Reported symptom | Actual defect | Check class it belongs to |
|---|---|---|
| Eye icon never re-reveals a saved secret | Eye toggled the input `type` over a field the API never populates; no reveal call | **1 — Round-trip** |
| Comment author shows the literal "Agent" | `comments.agent_id` written null; no identity on the MCP write path | **2 — Attribution** |
| Some marketplace agents never reach /agents | Install skipped `assertModelInRegistry`, died on `agents_cli_model_fk`; the reason was discarded client-side | **3 — List membership** |

Two structural reasons they survived, worth knowing before adding a test:

- **Web unit tests mock the API.** `CredentialsTable.test.tsx` mocks a non-null
  `token_fingerprint`; the real API nulled it on every read. api/web contract
  drift is invisible to vitest. A component test alone never closes a contract
  bug — pair it with a route test or an e2e assertion.
- **e2e specs stop at open/close.** `e2e/pages/credentials.spec.ts` (37 lines)
  never saves a credential and never reads one back.

Triage against [`coming-soon.md`](coming-soon.md) first — 11 controls toast or
sit disabled **on purpose**. A stub is not a bug.

---

## The six check classes

Apply to every route. Route sections below list only what is route-specific.

1. **Round-trip** — write a value, hard-reload, read it back. Does what you
   typed come back? Secrets need their reveal endpoint, not an input `type`
   flip.
2. **Attribution & joins** — every name, avatar, author, assignee and count
   rendered from an FK resolves to a real row. A hardcoded literal where a
   field belongs (`'Agent'`, `'PAT'`) is this class of bug. Grep the component
   for string literals that look like data.
3. **List membership** — anything created, installed or imported appears in the
   list that claims to show it, after invalidation AND after a hard reload. When
   a write fails, the UI names which item failed and why — never a bare count.
4. **Transition legality** — only valid next statuses are offered, and invalid
   ones are absent (not greyed). Always from `getValidNextStatuses()`; never a
   status list hardcoded in a component. **Swept 2026-09-12** — see
   *Transition legality* below for what "valid" means once the Owner override
   and the open-children rule are both in play.
5. **Cross-page propagation** — after a mutation, the sidenav badge, dashboard
   KPIs, search, queue and notifications agree without a manual refresh. SSE
   invalidation map: `api-surface.md` → *Web invalidation map*.
6. **Error / empty / loading** — all three non-happy states render, and a failed
   mutation surfaces visibly. A `throw` inside an async click handler is an
   unhandled rejection with no UI at all — check for it.

---

## Cross-cutting invariants

| # | Invariant | Why |
|---|---|---|
| X1 | No stored secret in a list/get response. Plaintext only via a `requireMcpToken` reveal endpoint that logs `{tag:'secret_reveal'}`. | `environment-secrets`, `projects/:id/env`, `credentials/:id/token`, `settings/external-notification/reveal-*` |
| X2 | Every writer into `agents` calls `assertModelInRegistry` first. | `agents(cli, model)` has a composite FK to `cli_models` with ON DELETE RESTRICT; skipping it yields an opaque 500 |
| X3 | Agent-authored rows carry `agent_id` / `actor_agent_id`. A null renders as "Agent", or worse, as the Owner. | `commentsService.create` resolves from the item's live run |
| X4 | Badge counts agree with the page they link to, or the difference is labelled. | Was violated by the Agents badge (active-only vs a page listing all) — fixed 2026-09-12; the rule is what caught it |
| X5 | Status logic only from `@atlas/shared/status-machine`. | duplicated transition tables drift silently |

---

## Routes

Wave letters match the sweep order (entity graph first, readers after).

### Wave A — projects

| Route | Route-specific checks |
|---|---|
| `/onboarding` | Owner name + accent + workspace folder survive `POST /settings/onboard` and a reload. Route guard: post-onboarding hit redirects to `/`; pre-onboarding hit on any other route redirects here. |
| `/` (Dashboard) | KPI numbers equal the same figures on Projects / Epics / Issues / Queue. "In motion" rows resolve agent names (`InMotionRow` reads `agent_name` denormalized by `counts.ts` — check it is populated, not falling back to "Unassigned"). AI-cost figures come from real `agent_runs` sums. |
| `/projects` | Create → appears without reload (SSE `counts_changed`) and after one. Delete → gone from Projects, Dashboard, sidenav badge, and the NewProjectModal credential picker. Clone/reclone stream SSE and land in a terminal state, not a spinner. Auto-fetch schedule round-trips its cron. |
| `/projects/:id` (5 tabs + Setup) | **Manage Secrets**: write → reload → per-row Reveal returns the stored value (X1); Copy copies the real value; Reveal-all fans out one call per row; Save with an untouched row preserves it instead of blanking it. Guard-rails tab writes reach `/projects/:id/guardrails`. Setup scripts round-trip both bodies. Tab state survives `?tab=` deep links. |
| `/projects/:id/guard-rails` | Redirects to `?tab=guardrails`. Add / toggle persists; toggle is not local-only. |

### Wave B — items

| Route | Route-specific checks |
|---|---|
| `/epics`, `/epics/new` | Create → visible on Epics, Issues (if it spawns children), Dashboard, badge. Stats row equals the listed rows. Draft vs Submit land different statuses. |
| `/epics/:id` | Title / description / priority inline edits round-trip. Status menu offers exactly `getValidNextStatuses()` (4). Assign offers only the Owner + agents valid at the current status. Activity feed authors resolve (2). Children counts match the child lists. |
| `/issues` | Merged story/bug/sub-task/sub-bug list equals the sum of the per-type endpoints. Archived rows hidden by default (known stub: the show-archived toggle). Filters do not drop rows silently. |
| `/issues/stories/:id` | Sub-task / sub-bug creation appears in both the child list and `/issues`. AC + spec round-trip. Comment compose posts as the Owner and renders the Owner name, never "Agent". Depends-on blockers actually refuse `in_progress` (`dependency-guard`). |
| `/issues/sub-tasks/:id`, `/issues/sub-bugs/:id` | No direct GET endpoint — the page resolves by scanning story children. Deep-link to one by URL with a cold cache and confirm it still resolves. |
| `/issues/bugs/:id` | Every bug-specific field (steps, expected, actual, frequency, failure scope, severity) round-trips. |

### Wave C — agents

| Route | Route-specific checks |
|---|---|
| `/agents` | Card count equals `GET /api/agents` length AND the marketplace's `is_installed` count. Sidenav badge vs page count (X4). Pause/resume, disable/enable, duplicate, delete all persist through a reload. Role filter: picking a specific role excludes `role_id IS NULL` autonomous agents **by design** — confirm that is what the user sees, not silent loss. |
| `/agents/:id` (6 tabs) | Prompt save bumps `prompt_version` and appends an `agent_prompt_versions` row. Handoff rules round-trip. Memory PUT flips `source` to `manual-edit` and bumps `version`. Run-now honours the depends-on gate (409 `dependencies_not_ready`). Model dropdown only offers registered models (X2). |
| `/agents/:id/runs/:runId` | Output matches `GET /api/run/:id`. Simulated runs carry the Simulated chip when `ATLAS_AI_ENABLED=false`. Re-run creates a new row, does not mutate this one. |
| `/agents/marketplace` | Catalog count == `marketplace_agents` rows. Select-all covers every not-installed entry. Bulk install: successes install, failures are **named with their reason** and stay selected; a clean sweep navigates to `/agents` (3). Install with a pruned model returns 400 `MODEL_NOT_IN_REGISTRY`, not a 500 (X2). |
| `/agents/marketplace/:id` | Install / upgrade / detach / export-zip each do what they claim. A non-409 install error toasts instead of throwing inside the click handler (6). |
| `/agents/mcp-tools` | Listed tools match `GET /api/tool-catalog`, which is re-synced per boot. |
| `/queue` | Rows equal `GET /api/run?limit=500` filtered to live states. Drawer's agent name + expected output are real, not keyed off a hardcoded id map (known stub). |

### Wave D — admin

| Route | Route-specific checks |
|---|---|
| `/settings` (5 tabs) | Profile round-trips. Env vars round-trip and Restart Server actually restarts. **Shared Secrets**: reveal returns the stored value (X1); save with untouched rows preserves them. Model Registry: removing a model still referenced by an agent or a catalog entry is refused with 409 and the reason is shown (X2). External notification: token/webhook reveal + test send. |
| `/settings/credentials` | Fingerprint column is populated (not nulled server-side). Kind chip reflects `credential.kind`, not a literal. Edit-mode eye fetches the stored PAT; `github_app` reveal is refused. Blank token on save keeps the existing one. Delete is blocked or cascades sanely for projects/sessions referencing it. |
| `/guardrails` | Create / update / delete / save persist. Known gap: Discard only resets the dirty counter, it does not roll edits back. |
| `/notifications` | Unread count equals the sidenav badge. Mark-all-read clears both. Resend / cancel move `external_status`. Agent attribution on in-app rows resolves (2). |
| `/reminders` | Create with a channel persists; fire delivers; cancel removes it from the list and the scheduler. |

### Wave E — read surfaces

| Route | Route-specific checks |
|---|---|
| `/search` | Results equal what the entity pages show for the same query. Bug / sub-task results land on their detail route (known stub: they fall back to `/issues`). |
| `/scratch-pad` | 5s autosave survives a reload; delete is not soft-only. |
| `/analytics`, `/analytics/project/:projectId`, `/analytics/epic/:epicId` | Totals equal the dashboard's and the entity pages'. Pagination does not drop or duplicate rows. Agent names come from the denormalized `agent_name`. |
| `/terminal`, `/terminal/standalone`, `/terminal/layout`, `/terminal/:id`, `/terminal/:id/history` | Session create → appears in the list and survives a reload. Pause/resume/stop reach terminal states. WS stream reconnects without losing the transcript. Standalone sessions carry their credential and commit under its identity. Diff panel matches `GET /api/cli-sessions/:id/diff`. |

All 37 routes now have a page doc. The last six were written 2026-09-12 as
part of this sweep: [`27-marketplace.md`](pages/27-marketplace.md),
[`28-marketplace-detail.md`](pages/28-marketplace-detail.md),
[`29-mcp-tools.md`](pages/29-mcp-tools.md),
[`30-analytics.md`](pages/30-analytics.md),
[`31-analytics-project.md`](pages/31-analytics-project.md),
[`32-analytics-epic.md`](pages/32-analytics-epic.md).

---

## Transition legality (swept 2026-09-12)

The machine (`packages/shared/src/status-machine/index.ts`):

| from | valid next |
|---|---|
| `draft` | `ready`, `waiting_for_info` |
| `ready` | `in_progress`, `waiting_for_info` |
| `in_progress` | `in_review`, `ready`, `waiting_for_info` |
| `waiting_for_info` | `ready`, `in_progress` |
| `in_review` | `done`, `in_progress`, `waiting_for_info` |
| `done` | (terminal) |

Two legitimate things sit on top of it, and neither is a violation:

- **Owner override.** `?override=1` bypasses the machine by design. The UI must
  keep it behind an explicitly labelled control — `StatusPickerPopover` renders
  a `MOVE TO` section (the machine's answer) and a separate `OVERRIDE` section
  (everything else). Overrides are stamped on the activity row with an
  `override` badge.
- **Open-children rule (P16).** Closing a parent with open children returns
  `422` naming every blocker, even though the machine allows
  `in_review → done`. Distinct status code, actionable message.

Verified: **150** (from, to) pairs — all 30 for each of the five item types
(epic, story, sub-task, sub-bug, bug) — probed against the live API agree with
the machine once those two rules are accounted for; `done → ready` is refused
(`400`), a leaf `in_review → done` is allowed (`200`), and the override path
permits `draft → done` (`200`). In the UI, `StatusTransitionBar`,
`StatusPickerPopover` and `WorkItemKanban` all derive from
`getValidNextStatuses()` — no hardcoded status lists in any component. The
picker was checked live on a story at a mid-state (`in_review` → MOVE TO holds
exactly done / in_progress / waiting_for_info) and at the terminal state (`done`
→ MOVE TO empty, all five others under OVERRIDE), and on a sub-task at `ready`
(→ in_progress / waiting_for_info; draft / in_review / done under OVERRIDE).

Two defects found and fixed in this pass, both on the Kanban drop path:

1. Dropping a card on an illegal column sent the transition through as
   `override: true` — a mis-drag silently bypassed the machine with no signal.
   Now refused, with a message naming the legal targets and pointing at the
   status picker.
2. `Epics.tsx` caught Kanban failures into an empty block commented "invalid
   moves are filtered upstream" (they weren't). The `422` open-children refusal
   — which names every blocking child — never reached the Owner; the card just
   snapped back in silence. Now surfaced in a toast.

## Sweep log

**2026-09-12.** All **37** routes in `App.tsx` exercised. Console errors across
the whole sweep: **two**, both deliberate 404 probes
(`/issues/bugs/does-not-exist`, `/issues/sub-tasks/TST-9999`), which correctly
render "Bug not found" / "Sub-task not found".

`/issues/bugs/:id`, `/issues/sub-tasks/:id` and `/issues/sub-bugs/:id` needed
fixtures — the workspace had no bug, sub-task or sub-bug row. Created one of
each, verified, then deleted. All three resolved on a **cold deep link** (fresh
page load, no warm cache), which is the case that matters for the two sub-item
routes: they have no direct GET endpoint and resolve by scanning story children.
Their not-found states are correct too. **Re-creating those three fixtures is a
prerequisite for re-testing these routes.**

Redirect-only routes, verified as redirects: `/onboarding` → `/` (post-onboarding
guard), `/projects/:id/guardrails` → `?tab=guardrails` (no-hyphen alias),
`/terminal/:id` → `/:id/history` for a closed session, `*` → `/`. The onboarding
**form** is still untested — that needs an un-onboarded workspace.

**SSE live propagation — swept 2026-09-12.** Verified by holding an
`EventSource` open (`curl -sN /api/events`) and watching pushes land, not by
reloading. The transport works: `: connected` flushes immediately and a
`counts_changed` frame arrives within ~1s of the write. What did *not* work was
which writes push at all — see **F2** below.

Still untested: a **real agent CLI run** (the whole run → handoff →
status-advance chain). `ATLAS_AI_ENABLED` was left off for the sweep so the
dev workspace kept its data.

Fixed this pass: secrets reveal (4 surfaces), comment attribution + backfill,
marketplace install FK guard + legible bulk-install failures, dashboard counts
frozen at 20, `role_id` FK 500, agent status labels inverted across 3 surfaces,
Kanban silent override, Epics swallowed Kanban errors, `/api/run` `agent_id` +
`issue_type` filters that never filtered, credential Kind chip, fingerprint
column, test-suite order dependence.

Verified correct (checked, not bugs — recorded so the next sweep doesn't re-chase them):

- **Analytics scopes reconcile exactly.** Project page `$8.12` = all-time
  completed runs `$7.5030` + closed terminal sessions `$0.6428`. The
  Dashboard/Analytics "September" figure (`$2.28`, 5 runs) uses a **local** month
  boundary against a UTC column — those 5 runs completed 18:32–20:32Z on Aug 31,
  i.e. Sept 1 00:02–02:02 in Asia/Calcutta. Correct, and the UI states the
  timezone. A UTC-midnight SQL comparison looks like a mismatch and isn't.
- **Terminal session counts.** `/terminal` shows 8 of 10 sessions; the 2 missing
  are standalone and live on `/terminal/standalone`. Correct scoping.
- **`GET /cli/sessions/:id/diff` → 409** on a closed session: the worktree is
  deleted after push by design (ephemeral-worktree lifecycle), and the error
  names it (`worktree_missing`).
- **Notification tab counts.** Notification Log shows 10 (external-delivery
  scope); In-App Feed shows 19, matching the sidenav badge and the API.
- **`/terminal/:id` on a closed session** redirects to `/:id/history`;
  **`/projects/:id/guard-rails`** redirects to `?tab=guardrails`. Both intended.
- **Guardrails page** 14 rules / 5 categories / 7 scripts — matches the API.

Cosmetic, fixed in the same pass (`30789c3`): `/terminal/:id/history` rendered
`Closed at` / `Transcript captured` as raw UTC ISO strings (now `formatAbsolute`,
like every other surface), and the Projects subtitle read "1 projects · 1 epics".

Cosmetic, still open: eight other count headers have no singular form either —
`Epics.tsx:148`, `Issues.tsx:315`, `Guardrails.tsx:154`, `Terminal.tsx:168`,
`TerminalStandalone.tsx:114`, `AnalyticsProject.tsx:363,469,513`. One shared
`plural()` helper would close all eight; not worth an eight-file diff on its own,
so fold it into the next edit that touches those files.

## Open findings

Carried here rather than fixed, because each is a product-semantics call.

**F1 — RESOLVED 2026-09-12.** The sidenav Agents badge filtered
`status='active'`, so it read 10 while `/agents` listed 16 and `/queue`'s header
counted 16 — three surfaces, two answers, and it read as "6 agents are missing".
Now counts every agent, consistent with its five siblings (projects, epics,
issues, queue, notifications), all of which count every row. The dashboard's
`activeAgents` KPI is unchanged: it is explicitly labelled "active", so the
filter there is honest.

**F2 — RESOLVED 2026-09-12.** Half the entity writes never pushed on SSE.
`.agents/architecture.md:348` already required it ("If you add a new mutation in
the API, you MUST `broadcastSSE()` after the DB write"); `epics`, `stories` and
`issues` complied, `agents` and `projects` did not. Proven live by holding an
`EventSource` open: creating an epic pushed `counts_changed`; creating a project
(badge 1 → 2) and an agent (16 → 17) pushed nothing at all.

The web half was broken symmetrically. `counts_changed` reports the `agents` and
`projects` badge counts, but its handler invalidated six query keys and neither
of those two lists. So on the one path that *did* broadcast — marketplace
install, patched at the call site in `routes/marketplace.ts:74` — an open
`/agents` page kept showing the pre-install set while the badge beside it moved.
**That is the reported "agents are missing from the Agents page" symptom on a
second axis**, independent of the FK 500 that was fixed first.

Fixed in the services, not the routes: `agentsService.create/update/delete` and
`projectsService.create/createFromClone/update/delete` now broadcast after the
transaction commits (never inside it — a rolled-back insert must not tell
clients to refetch), and `useSSE.ts` adds `['agents']` + `['projects']`.
`projectsService.createFromClone` had two callers and only one of them
(`clone-runner`) pushed anything.

**F3 — RESOLVED 2026-09-12.** A stranded run, found in `e2e-logs/api.log` rather
than in the UI: `duplicate key value violates unique constraint
"agent_runs_one_live_per_item"`, logged as "unhandled promise rejection (kept
alive)".

`agent-runner.ts` promotes a queued run with a bare
`setTimeout(() => { void (async () => { … })(); }, 200)`. Two defects in that
one construct:

- The promotion was unconditional. 200 ms is ample for the row to leave the
  live set (cancelled by the Owner, swept by `failOrphanedRuns`, deleted with
  its item), and a replacement run may already hold the item's slot — so the
  flip re-entered the live set behind the replacement's back and hit the partial
  unique index from migration `003`. Now `.where('status','=','queued')` with a
  `numUpdatedRows` check: losing the flip means the run isn't ours to start.
- Nothing from the promotion down to `spawnCli` had a `catch`, so any throw was
  an unhandled rejection and the run sat at `in_progress` until the next boot
  sweep, with the reason only in the API log. Now `.catch()` → `errorRun()`,
  which finalizes the row, puts the message on the run-detail page and notifies
  the Owner.

Same class as the pre-spawn failures fixed earlier in this branch
(`outcome_summary` written but never SELECTed): **an error that exists only in a
log or a column nobody reads.** That is the recurring theme of this whole sweep.

## Carried forward — needs an Owner decision

**C1 — `comments.author_name` denormalization.** `comments_agent_id_fkey … ON
DELETE SET NULL` means deleting an agent retroactively erases its name from
every comment it ever wrote, and `ActivityCard.tsx` falls back to the literal
`'Agent'`. The write-time attribution fix in this branch stops *new* comments
losing their `agent_id`, but cannot survive the agent row being deleted. The
change is scoped and ready — DB column + backfill migration, a stamp in
`commentsService.create`, `author_name` on `IComment`, and
`agent?.name ?? comment.author_name ?? 'Agent'` in the card — but it needs
`author_name` added to `IComment` in `packages/shared/src/types/index.ts`, and
`packages/shared/` is protected by `AGENTS.md`. **Not started: waiting on an
explicit "yes, edit shared".** The in-repo precedent for denormalizing a name
is `counts.ts:270,286` and `routes/analytics.ts:185`.

**C2 — five unseeded `SdlcRole` slugs.** `spec-writer`, `tester`, `devops`,
`security` and `designer` are in the `SdlcRole` union in `@atlas/shared` but not
in the `roles` table, so assigning one used to 500 on `agents_role_id_fkey`.
That is fixed (`RoleNotInCatalogError` → 400 naming the valid slugs), but
seeding them properly needs curated `default_prompt_md` for each, which is
product content, not something to invent. Either seed the five with real prompts
or narrow the union to the five that exist.
