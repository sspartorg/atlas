# 09 — Security re-audit: confirm 0 advisories still holds

**Status:** todo
**Depends on:** tasks 02–06
**Scope:** infra

## Why

The predecessor's F-020 went from 43 advisories — 20 high — to **0**, by pinning
18 security floors in `pnpm-workspace.yaml`. That is where pnpm 11 reads
overrides from, not `package.json`, which is the detail that made the earlier
attempts fail.

Advisories publish daily, and this board adds test dependencies and touches the
lockfile. A number that was true on 2026-09-20 is not evidence on 2026-09-21.

Runs late, after the tasks that can change the dependency tree.

## What to do

1. `pnpm audit`. Record the output verbatim.
2. For any new advisory: take the floor from that advisory's own
   `patched_versions`, and **check the lockfile resolves the module to exactly
   one version first**. A caret override across two majors strands a consumer.
3. `pnpm peers check` after any bump — the predecessor found `vitest` and
   `@vitest/coverage-v8` had to move together or the peer went unmet.
4. Re-run the full suite after any dependency change. A green audit with a red
   suite is not a result.

## Scope discipline

Ruling D-10 carried over: evidence-based and targeted. **No STRIDE pass, no
SBOM, no threat-model document.** The Owner's goal is that a company adopting
Atlas sees a clean audit, not that this board produces security paperwork.

Note also what a clean `pnpm audit` does and does not prove. It proves no known
advisory matches a resolved version in the tree. It does not prove reachability
— the predecessor was explicit that it never assessed whether the vulnerable
code paths execute — and it says nothing about Atlas's own code. Task-10's
verdict must not overstate it.

## Traps

- Overrides live in `pnpm-workspace.yaml`. Adding them to `package.json` looks
  right, changes nothing, and reads as a fix.
- A first run on this board already returned `No known vulnerabilities found`
  (2026-09-21, before any change). That is the baseline, not the result.

## Done when

- [ ] `pnpm audit` → 0 advisories, output pasted
- [ ] Any new floor pinned in `pnpm-workspace.yaml` with its advisory cited
- [ ] `pnpm peers check` clean
- [ ] Full suite green after any dependency change
- [ ] The verdict language for task-10 drafted here, stating the limits of the claim

## Evidence

**2026-09-21, pre-change baseline:** `pnpm audit` → `No known vulnerabilities found`.

_Remainder written after execution._
