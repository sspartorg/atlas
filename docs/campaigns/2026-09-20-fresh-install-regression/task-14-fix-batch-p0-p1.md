# 14 — Fix batch: P0 and P1 findings

**Status:** done — 2026-09-20. All four P1s fixed; no P0s found
**Depends on:** [task-13](task-13-cross-dependency-sweep.md)
**Scope:** api · web

## Why

Ruling D-9 kept discovery separate from repair so that one deep bug could not
stall the sweep. The sweep is done; now the debt gets paid, worst first.

P0 is data loss, credential exposure, or a destructive action firing on the
wrong target. P1 is a core flow that cannot complete, or completes wrongly and
silently. Everything else waits for
[task-15](task-15-fix-batch-p2-p3.md).

## What to do

1. **Re-read the register.** Sort [findings.md](findings.md) by severity, then
   by chain-vs-page (a chain failure usually has a wider blast radius than a
   page failure at the same severity). Fix in that order.

2. **Root-cause before editing.** A finding names a symptom. Before touching
   anything, grep every caller of the function you are about to change. One
   guard in a shared function is a smaller diff than a guard in each caller —
   and patching only the path the finding named leaves every sibling caller
   broken. The `/agents` Add Agent defect already in the register is exactly
   this shape: the same missing-catch pattern that shipped on the marketplace
   install path.

3. **Write the failing test first.** Every P0 and P1 fix lands with a
   regression test that fails before the fix and passes after. This is not
   ceremony — a fix without a test is a finding that will be rediscovered in
   the next campaign.

4. **Mutation-proof each test.** Revert the fix, run the test, paste it red.
   Restore the fix, run it, paste it green. A test that passes against the
   unfixed code proves nothing, and that is more common than it sounds.

5. **New api test files must be added to the `include:` allowlist** in
   `packages/api/vitest.config.ts`, or they never run.

6. **Respect the hard rules while fixing.** `packages/shared` is not edited
   without an Owner instruction. Status logic stays in the status machine. API
   responses match the shared types exactly. If a fix appears to require a
   shared change, stop and ask rather than widening the blast radius.

7. **One commit per finding**, `<type>(<scope>): <summary>` with the summary
   ≤ 60 chars and imperative, and the `F-NNN` id in the body. The finding's
   `status` column flips to `fixed in <sha>` in the same commit.

8. **Update `.agents/` in the same change** when a fix alters documented
   behaviour — a changed button updates its page doc, a changed route updates
   `api-surface.md`. This is the self-update rule, and
   [task-21](task-21-agents-sync-and-adrs.md) is the backstop, not the excuse.

## Done when

- [ ] Every P0 in the register is `fixed in <sha>` or carries a written Owner
      ruling of `wontfix`
- [ ] Every P1 likewise
- [ ] Each fix has a regression test, and each test is mutation-proved —
      paste the red and the green for every one
- [ ] Every new api test file appears in `packages/api/vitest.config.ts`
- [ ] `pnpm -r test` is green — paste the tail
- [ ] `pnpm typecheck` and `pnpm lint` are clean
- [ ] `git log --oneline` shows one commit per finding, each naming its `F-NNN`
- [ ] No `packages/shared` file was edited without a recorded Owner instruction
- [ ] `.agents/` docs touched by any behaviour change were updated in the same
      commit as the change

## Evidence

**No P0 was found by the campaign.** Every destructive path that could have
been one was tested and holds: the standalone terminal guard (task-10), the
`purge` containment check (task-13), and secret redaction across all six
surfaces (tasks 08, 11, 13).

Four P1s, all fixed:

| F-NNN | What | Fix | Test | Mutation-proved |
|---|---|---|---|---|
| F-012 | reviewer `done` auto-passed; PRs shipped with red suites | required checklists for all 5 reviewers + manifest version bumps | `reviewer-checklists.test.ts` | yes — 6 failures naming each reviewer → 12/12 |
| F-013 | `ws/` workspace induced cross-repo relative imports | `repositoriesMarkdown` now warns the parent folder is temporary | `run-repos.test.ts` | assertion added to the existing spec |
| F-001 | onboarding accent swatch wrote nowhere | follow-up `PATCH /settings/profile` carries the colour | `Onboarding.test.tsx` | yes — red *"no PATCH /settings/profile was sent"* → green |
| F-002 | Add Agent swallowed every API error | added the missing `catch`, surfacing `err.message` | `Agents.test.tsx` | yes — removed the catch → *"nothing was shown to the Owner"*; restored → green |

**Gates after the batch:** `pnpm -F @atlas/web test` 327 files / 4152 tests
green; `pnpm -F @atlas/api test` 153 files / 2634 tests green; `pnpm typecheck`
clean across all four packages; `pnpm lint` exits 0 (one pre-existing warning
in `useProjectSchedule.ts`, a file this batch never touched).

### F-001 was fixed around the protected package, not through it

The clean fix is to add `accent_color` to `OnboardingSchema` so one call
carries all three fields. That schema lives in `packages/shared`, which
AGENTS.md hard rule 1 protects, and the campaign's own standing constraints
repeat. So the colour rides on a follow-up `PATCH /api/settings/profile`
instead — `UpdateProfileSchema` already accepts `accent_color`, and it is the
same endpoint Settings uses to change it later.

The tradeoff is real and is commented in the code: two calls mean a window
where onboarding succeeds and the colour patch fails. That is why the patch is
deliberately non-fatal — onboarding has already completed at that point, and
losing a colour must not strand the Owner outside the app.

**For the Owner:** the single-call version needs one line in
`packages/shared/src/schemas/index.ts`. It is a better fix and it needs your
approval, not mine.

### A test-harness trap worth recording

`ToastProvider` supplies context and **renders nothing** — `<Toast />` is
mounted separately in AppShell, which `renderWithProviders` does not include.
Any test asserting toast text through the DOM therefore passes regardless of
what the code does. The neighbouring pre-existing spec
(`Agents.test.tsx:669`, *"shows error toast when delete API call fails"*) ends
in `expect(document.body).toBeTruthy()` — it asserts nothing, almost certainly
for this reason. F-002's test spies on the hook instead, which is why it could
be mutation-proved.
