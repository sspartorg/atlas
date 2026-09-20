# 18 — Coverage lift against the ADR 0009 tiers

**Status:** todo
**Depends on:** [task-15](task-15-fix-batch-p2-p3.md)
**Scope:** api · web · mcp

## Why

The Owner asked for 95% coverage. ADR 0009 set per-package tiers on 2026-05-24
because the four packages have genuinely different testability profiles, and a
single uniform floor would have to be either low enough to admit `web` — which
would let `shared` regress unnoticed — or high enough to gate `shared`, which
would block `web` work forever.

Ruling D-5: **the tiers stand and are amended, not overturned.**

| Package | Target | Floor CI enforces today |
|---|---|---|
| `@atlas/shared` | 100% | 100% across the board |
| `@atlas/mcp` | 95% | lines 85, statements 85, functions 60, branches 90 |
| `@atlas/api` | 95% | lines 95, statements 95, functions 95, branches 86 |
| `@atlas/web` | 80% | lines 70, statements 70, branches 65, functions 59 |

The gap the Owner cares about is real, but it is concentrated: `web`'s floor
is below its own target, and `mcp`'s function coverage sits at 60. Those are
the two to move. `api` is already at 95 lines and needs only its branch number
lifted.

## What to do

1. **Measure before deciding anything.** `pnpm -r test:coverage`, then record
   the real per-package numbers and the ten largest uncovered files per
   package. The floors in the table above are what CI enforces; the actual
   numbers are usually higher, and the difference is where the cheap wins are.

2. **Do not chase the excluded surfaces first.** `Agents.tsx`, `AgentDetail.tsx`,
   `Queue.tsx` and the heavy modals (700–1800 LOC each) are excluded from `web`
   measurement entirely, deliberately — they are covered by Playwright instead.
   Including them would make the floor both dishonest and unreachable. Leave
   the exclusions alone unless the Owner rules otherwise.

3. **Raise `web` 70 → 80 lines** with hooks and view-model tests, which is the
   path ADR 0009 itself documents in `.agents/testing.md`. Prefer a hook test
   over a component test: hooks hold the logic, components hold the MUI.

4. **Raise `mcp` functions 60 → 95.** Each tool registration adds two functions
   (metadata plus handler); the metadata halves are trivially coverable and are
   most of the shortfall.

5. **Raise `api` branches 86 → 90** where the uncovered branches are real. Some
   are not: FK-protected defensive null-coalesces and platform-specific paths
   (`crypto.ts` HKDF, the Windows registry code) cannot execute on a single
   macOS runner. Record those as permanently unreachable rather than writing a
   test that mocks the platform into existence.

6. **A component test alone never closes a contract bug.** This is the lesson
   `.agents/functional-checklist.md` opens with: `CredentialsTable.test.tsx`
   mocked a non-null `token_fingerprint` while the real API nulled it on every
   read, so vitest could not see the drift. Pair every web test that asserts an
   API shape with a route test or an e2e assertion.

7. **Raise the floors in each `vitest.config.ts`** to the new measured numbers
   once the tests land. A floor that is not raised does not gate anything.

8. **Amend ADR 0009** — do not supersede it. Add a dated amendment section
   recording the new floors, the measurement that justified them, and that the
   exclusion list is unchanged. Update `.agents/testing.md` alongside.

## Done when

- [ ] Pre-work per-package coverage numbers are pasted, with the ten largest
      uncovered files per package
- [ ] `@atlas/shared` is still 100% across the board
- [ ] `@atlas/mcp` functions ≥ 95, and the other three metrics did not regress
- [ ] `@atlas/api` branches ≥ 90, lines/statements/functions still ≥ 95
- [ ] `@atlas/web` lines ≥ 80 and statements ≥ 80
- [ ] Every raised floor is written into that package's `vitest.config.ts` —
      paste the four diffs
- [ ] Permanently unreachable branches are listed with their reason, not
      papered over with platform mocks
- [ ] The `web` exclusion list is unchanged, or its change carries an Owner
      ruling
- [ ] Every new api test file is in `packages/api/vitest.config.ts`'s
      `include:` allowlist
- [ ] `pnpm -w run gate` passes end to end — paste the tail
- [ ] ADR 0009 carries a dated amendment; `.agents/testing.md` agrees with it

## Evidence

*(filled during execution)*

| Package | Before | After | Floor set to |
|---|---|---|---|
| shared | | | |
| mcp | | | |
| api | | | |
| web | | | |
