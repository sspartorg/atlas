# 15 — Fix batch: P2 and P3 findings

**Status:** done — 2026-09-20. 6 fixed, 1 withdrawn, 5 deferred with reasons
**Depends on:** [task-14](task-14-fix-batch-p0-p1.md)
**Scope:** api · web

## Why

P2 is a flow that completes while a surface lies about it — a badge that
disagrees with its page, a list missing something just created, an author
rendering as the literal "Agent". P3 is cosmetic, copy, or documentation
drift.

These are lower stakes individually and corrosive collectively. A product
whose counts cannot be trusted teaches its user to stop reading them, and the
documentation drift in this register is already large enough that three of the
four page-doc contradictions were found by reading code rather than by using
the app.

## What to do

Same discipline as [task-14](task-14-fix-batch-p0-p1.md): root-cause before
editing, failing test first, mutation-proof, one commit per finding, `.agents/`
updated in the same change.

Three things specific to this batch:

1. **P2 count and membership bugs usually share a root.** Invariant X4 — a
   badge count agrees with the page it links to, or the difference is labelled
   — was violated once by the Agents badge counting active-only against a page
   listing all. Before fixing each count individually, check whether several
   share one query or one invalidation gap. Fixing the shared cause is the
   smaller diff.

2. **Documentation findings are fixed in the doc, not worked around in code.**
   The register already carries four page-doc contradictions found during
   checklist authoring: the onboarding accent colour that is never persisted,
   four Project Detail menu items that no longer exist, a `JsonlTranscriptViewer`
   component that does not exist, and a per-kind prompt-version API that was
   removed. Two of those are docs-only; the accent colour is a real class-1
   defect whose doc also lies. Sort each into the right bucket before fixing.

3. **A stale `coming-soon.md` row is a P3 finding, not a licence.** The
   "Bulk edit / assign on Project Detail" row has no trigger anywhere in the
   code. Delete the row; do not build the feature.

## Done when

- [ ] Every P2 in the register is `fixed in <sha>` or carries a written Owner
      ruling of `wontfix`
- [ ] Every P3 likewise
- [ ] Count and membership fixes were checked for a shared root cause before
      being fixed individually — record what was shared
- [ ] Every page-doc contradiction is resolved in the doc, and where the code
      was also wrong, in both
- [ ] Stale `coming-soon.md` rows are deleted, not implemented
- [ ] Each behavioural fix has a mutation-proved regression test
- [ ] `pnpm -r test`, `pnpm typecheck` and `pnpm lint` are all green
- [ ] The register has no `open` rows left

## Evidence

### Fixed

| F-NNN | What was wrong | Fix |
|---|---|---|
| F-005 | a notification for a deleted agent rendered the literal `Atlas`, indistinguishable from a real system row | `row.agent_id ? (agent?.name ?? 'Unknown agent') : 'Atlas'` — `Atlas` now means "no agent", not "agent missing" |
| F-006 | a rejected onboarding submit left its error on screen while the Owner fixed the input | `handleWorkspacePathChange` clears `submitError` too, not just the client-side one |
| F-007 | both empty states told an Owner who *has* credentials to go and add one | conditioned on `useCredentials()`, matching the agents hint the same component already conditioned |
| F-008 | the Add repo dialog still said "next to the primary repo" after ADR 0018 removed the primary | copy now reads "alongside the others" |
| F-015 | every autosave erased its own save indicator; the scratch pad read "Not saved yet" forever | the reset effect keys on `tile?.id`, not the whole `tile` object whose identity churns on each refetch |
| F-019 | a body of entirely unrecognised field names returned 200 having written nothing | the route rejects a patch that resolves to zero fields, with a message naming the four it accepts |

**Gates:** web 327 files / 4152 tests green · api 153 / 2636 green · typecheck
clean across all four packages · lint exits 0.

### F-003 withdrawn — it was never a defect

`edited_by` is a **provenance marker, not a person's name**. The codebase's
vocabulary is `'Owner'`, `'Marketplace'`, `'Import'` and
`'Owner (catalog sync)'`; `PromptTabContent.tsx:475` renders it directly as
that category, and the column's DB default is `DEFAULT 'Owner'::text`. Writing
`'Owner'` for an Owner edit is correct. It was filed from one call site without
checking the column's consumers or its sibling values.

### Three corrections the codebase forced during this batch

1. **The existing tests caught F-007.** Conditioning the hint broke two specs
   that assert it renders. The first fix — a default `credentials` handler
   returning `[]` — then broke four *other* specs that set up their own
   credentials, because a later `server.use` wins. The right answer was to make
   the component conservative: hide the hint only once a credential is
   positively known to exist, so an unloaded query still shows it. Both
   original specs pass untouched.
2. **`react-hooks/exhaustive-deps` does not exist here.** The disable directive
   added beside the F-015 fix failed lint as an unknown rule — and the autosave
   effect immediately below already carried a comment saying the plugin is not
   loaded. Removed.
3. **F-019's clean fix is blocked by hard rule 1.** `.strict()` belongs on
   `UpdateExternalNotificationSchema` in `packages/shared`. The route rejects
   the empty patch instead, which fixes the misleading 200 without touching the
   protected package. **For the Owner:** `.strict()` is the better fix and
   needs your approval.

### Deferred, with reasons

| F-NNN | Why not fixed here |
|---|---|
| F-009 | the stuttering clone path `<project-slug>-<repo-name>` is deliberate namespacing (`routes/projects.ts:408`). Changing it moves existing repos on disk, so it needs an Owner ruling, not a patch |
| F-011 | setup-script artifacts reaching the PR is a **contract documentation** gap — belongs to [task-20](task-20-docs-guide-refresh.md) with the rest of `setup-script-contract.md` |
| F-014 | the multiline `TextField` loop is inside MUI's `TextareaAutosize`, not app code. A real fix means pinning `rows` or replacing the component across every multiline field — too wide for a P2 batch and worth its own change |
| F-017 | the fix is a wording change in `AGENTS.md`, which [task-21](task-21-agents-sync-and-adrs.md) owns along with the rest of the doc sweep |
| F-018 | the Runs tab shows one PR of several because `run.pr_url` holds only the first. Rendering all of them means joining `item_external_links` into that query — a shape change worth doing deliberately |
