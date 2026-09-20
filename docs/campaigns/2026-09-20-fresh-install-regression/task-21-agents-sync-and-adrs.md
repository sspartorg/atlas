# 21 — Sync `.agents/` and write the ADRs

**Status:** todo
**Depends on:** [task-20](task-20-docs-guide-refresh.md)
**Scope:** docs

## Why

`.agents/` is the cache that stops every future conversation from
re-exploring the codebase. The self-update rule says a doc changes in the same
commit as the code it describes — this task is the **backstop**, not the
excuse. Tasks 14, 15 and 17 each update their own docs; this one sweeps what
they missed and fixes the drift that authoring the checklists already exposed.

That drift is not hypothetical. Writing `checklists/per-page.md` turned up
**fourteen** places where a page doc describes something the code does not do.
Three of those would make a tester file a false bug, which is worse than no
doc at all.

## The drift found during checklist authoring

File each as a finding, then fix. All were verified against the code, not
inferred.

| # | Doc | Reality |
|---|---|---|
| 1 | `00-onboarding.md:43,53` — payload includes `accent_color`; "Color selection persists into `settings.accent_color`" | `api/api.ts:299-300` sends two fields; `services/settings.ts:186-194` writes `owner_name`/`workspace_path`/`onboarding_complete` only. **The swatch picker writes to nowhere.** `.agents/functional-checklist.md:69` repeats the claim. This is a real class-1 defect *and* a doc lie |
| 2 | `03-project-detail.md:23-31` — lists Edit repository URL, Change default branch, Notification routing, Archive project; calls Rename a stub | `ProjectActionsMenu.tsx:57-96` has Rename (real), Edit guard-rails, Manage Secrets, Generate AI scaffold (undocumented), Delete. The four listed items are gone |
| 3 | `coming-soon.md` — "Bulk edit / assign on Project Detail" | no trigger anywhere in `ProjectDetail.tsx` or `pages/project/`. Stale row |
| 4 | `05-tasks.md` — "shift-drop overrides the status machine" | `WorkItemKanban.tsx:237-256` refuses an illegal drop with a toast naming legal targets. No shift path exists |
| 5 | `25-terminal-history.md:20,34,40-43` — a `JsonlTranscriptViewer` with role chips and a 5000-event cap | no such file. `TerminalHistory.tsx:16,177-185` renders the shared `RunEventViewer`. The `AiUsagePanel` cost card at `:195-201` is undocumented |
| 6 | `16a-agent-run-detail.md:25,58` — "Re-run with same inputs" always available | gated by `canRerun = !run.workflow_run_id && !run.issue_id` (`AgentRunDetail.tsx:247`). Stop run and Open workflow run (`:475-481`) are undocumented |
| 7 | `16-agent-detail.md:58` — two prompt-version tables, `?kind=performer`/`?kind=reviewer` | the client has no `kind` param (`api/api.ts:423-429`). The doc contradicts itself at `:57` |
| 8 | `29-mcp-tools.md:6-7,40` — mirrors the Agent Detail "Allowed tools" picker | that picker was removed by B14 (`d3cc9bf`) |
| 9 | `23-terminal.md:78-79` — multi-pane workspace and history routing listed as coming soon | both ship (`Terminal.tsx:174`, `:255`), and neither is in `coming-soon.md` |
| 10 | `23-terminal.md:31,70` — CLI icons from `utils/cliPresentation.ts` | `Terminal.tsx:14` imports `cliIcon` from `utils/cliIcons.ts`, deliberately split out |
| 11 | `15-agents.md` — no Import-zip control, no `PageFab` | both exist (`Agents.tsx:613,622`) |
| 12 | `19-settings.md:31,102,107` — a Restart Server button with a confirm dialog | `EnvironmentTab.tsx:149-181` is a static Alert saying to Ctrl+C `pnpm dev`. No button, no hook; `api/api.ts:342` is unused |
| 13 | `19-settings.md:10` claims 7 tabs but has **no Shared Secrets section**; `:34` describes an inline Model Registry add row (both paths now use `ModelEditModal`, and edit is note-only); `:16-20` omits the theme toggle; `:38-72` omits Web Push and Terminal Idle | — |
| 14 | `coming-soon.md` rows 1–2 + `20-credentials.md:18,29,30` — Verify now / Check expiries / Copy fingerprint | `CredentialRowMenu.tsx:14-23` has Edit and Delete only; `Credentials.tsx:182-194` has only Add credential. **Gone, not stubbed** — delete the rows |
| 15 | `18-guardrails.md:75` — dirty counter does not decrement on Save | `Guardrails.tsx:92` calls `setDirtyCount(0)` in `handleSaveAll`. Inverted |
| 16 | `14-search.md:21` — "Save This Search" and ⌘S | no such control in `Search.tsx` or `search/*.tsx` |
| 17 | `21-reminders.md:54-57` omits `PATCH /api/reminders/:id`; `20-credentials.md:17` shows the expiring-soon summary unconditionally, but `Credentials.tsx:178` appends it only when the count is > 0 | — |

## What to do

1. **Fix all seventeen**, in the page doc the row names. A removed feature is
   deleted from the doc, not marked as coming soon. A shipped feature is added.
   An inverted claim is corrected in place.

2. **Sweep `coming-soon.md` properly.** Rows 1–2 and the Chat-ID "Detect"
   button describe controls that no longer exist. The conventions doc's own
   trigger table covers this: when a UI file is deleted, sweep `coming-soon.md`
   for stubs pointing at it. That sweep did not happen, and this is the lesson
   from the B14 autonomous-tab rip-out repeating.

3. **Re-verify the eleven-stub claim.** `.agents/functional-checklist.md` and
   several page docs assert that eleven controls are intentional stubs. After
   the sweep, count what is actually left and correct every place that states
   the number.

4. **Propagate the campaign's own code changes.** Walk the self-update trigger
   table in `.agents/conventions.md` against everything tasks 14–18 changed:
   page docs for UI changes, `api-surface.md` for routes, SSE events, services
   and the migration index, `data-model.md` for entity fields and status
   transitions, `routes-map.md` for new routes or sidenav changes.

5. **Write the ADRs.** Format is Nygard — Context, Decision, Consequences — no
   frontmatter, `NNNN-kebab-case-slug.md`, immutable once accepted, with a row
   added to `docs/adr/README.md` in the same change.
   - **0019** — the second migration squash. Written in
     [task-01](task-01-migration-squash.md); confirm it exists and supersedes
     0002.
   - **0009 amendment** — the coverage floors from
     [task-18](task-18-coverage-lift.md). An amendment section on the existing
     ADR, not a new one; 0009 is amended, not overturned (ruling D-5).
   - **A new ADR only if the campaign made a decision worth freezing** — for
     example, if task-16 established a rule about when an index is justified,
     or task-20 chose a screenshot-generation method. Do not write an ADR for
     work that merely happened.

6. **Leave no bare `TODO(.agents):` markers.** Reviewers flag any older than a
   week; this campaign should not create any.

## Done when

- [ ] All seventeen drift rows are fixed — paste the diff summary per file
- [ ] `coming-soon.md` contains no row whose Location points at code that does
      not exist — paste the verification
- [ ] The stub count is re-derived and every statement of it agrees
- [ ] Every code change from tasks 14–18 has its `.agents/` counterpart, checked
      against the conventions trigger table row by row
- [ ] `docs/adr/0019-*.md` exists; ADR 0002 is marked superseded; the README
      index has the row
- [ ] ADR 0009 carries a dated amendment section with the new floors
- [ ] `grep -rn 'TODO(.agents):' .` returns 0
- [ ] `.agents/functional-checklist.md:69`'s accent-colour claim is corrected
- [ ] A fresh reader can answer "what does this button do" from `.agents/`
      alone for every page walked in waves A–E

## Evidence

*(filled during execution)*
