# 15 — Fix batch: P2 and P3 findings

**Status:** todo — depends on 14
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

*(filled during execution)*

| F-NNN | sev | fix sha | test file | mutation-proved |
|---|---|---|---|---|
| | | | | |
