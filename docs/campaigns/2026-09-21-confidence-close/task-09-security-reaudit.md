# 09 — Security re-audit: confirm 0 advisories still holds

**Status:** done — 2026-09-21
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

- [x] `pnpm audit` → 0 advisories, output pasted
- [x] Any new floor pinned in `pnpm-workspace.yaml` with its advisory cited
- [x] `pnpm peers check` clean
- [x] Full suite green after any dependency change
- [x] The verdict language for task-10 drafted here, stating the limits of the claim

## Evidence

**2026-09-21, pre-change baseline:** `pnpm audit` → `No known vulnerabilities found`.

**2026-09-21, after every change on this board:** `pnpm audit` →
`No known vulnerabilities found`. Peer resolution clean —
`pnpm install --resolution-only` reports `Already up to date` with no unmet
peers.

No new floor was needed. This board added no runtime dependency: every change
was test code, documentation, one new service module (`verification-gate.ts`,
which imports only `node:child_process`, `node:util`, `node:fs/promises` and
`node:path`), and two one-line source fixes. The 18 floors the predecessor
pinned in `pnpm-workspace.yaml` still hold, and nothing published in the
intervening day matched this tree.

### The language task-10 must use, and why

**"0 vulnerabilities" is not what this proves, and the verdict will not claim
it.** A clean `pnpm audit` means: no advisory currently in the registry matches
a version currently resolved in this lockfile. It is a real and useful result —
it went from 43 advisories, 20 of them high, to zero — but three things it is
not:

1. **Not a reachability analysis.** The predecessor was explicit that it never
   assessed whether the vulnerable code paths execute. Neither did this pass.
   A path existing in the tree is not proof the vulnerable function is called;
   equally, its absence from the advisory list is not proof of safety.
2. **Not a statement about Atlas's own code.** `pnpm audit` reads third-party
   metadata. It has nothing to say about the credential handling, the MCP write
   gate, the secret redaction, or anything else this repo wrote. Those were
   examined by the predecessor's F-021 and F-022 and by this board's work on
   `routes/credentials.ts` — but examined is not the same as audited.
3. **Not durable.** Advisories publish daily. This sentence is true on
   2026-09-21 and says nothing about 2026-09-22. The value is the pinned floors
   and the fact that the check is cheap to repeat, not the number itself.

Ruling D-10 carried over, so no STRIDE pass, no SBOM, no threat model. The
Owner's brief asked for "0 vulnerabilities so companies can adopt this"; what
can honestly be handed to such a company is a clean dependency audit, pinned
security floors, a closed-by-default MCP write gate, and the named limits
above.
