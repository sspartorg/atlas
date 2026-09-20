# 14 — Fix batch: P0 and P1 findings

**Status:** todo — depends on 8–13
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

*(filled during execution)*

| F-NNN | sev | fix sha | test file | mutation-proved |
|---|---|---|---|---|
| | | | | |
