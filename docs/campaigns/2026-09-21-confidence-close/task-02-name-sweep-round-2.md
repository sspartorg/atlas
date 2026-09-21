# 02 — Leftover-name sweep round 2

**Status:** todo
**Depends on:** task-01
**Scope:** api · shared · web · docs

## Why

G-001 and G-002. The predecessor's ruling D-3 searched for `insightsoftware`,
`Linoes` and `CER`, found the first two absent, renamed the third, and closed.
`Linoes` really is absent. But `isw` is insightsoftware's org prefix and
`CDM Next` is one of their products, so `isw-CDM-Next` / `cdmnext-claude-bot`
survived the sweep nine times — including two comments in shipping API source
that cite another company's internal bot playbook as the stated rationale for
Atlas's git-credential design.

`sspartorg/atlas` is **public**. That is what makes this P0 rather than
housekeeping.

Ruling E-5 scopes the remedy: working tree and tracked docs only, no history
rewrite. The old commits stay readable and the verdict in task-10 says so.

## The inventory

| where | hits | what |
|---|---|---|
| `packages/api/src/services/git-credentials.ts:31` | 1 | comment — "same shape isw-CDM-Next uses for `cdmnext-claude-bot`" |
| `packages/api/src/services/worktree-orchestrator.ts:1041` | 1 | comment — "the isw-CDM-Next/cdmnext-claude-bot playbook" |
| `packages/api/src/services/github-app-tokens.test.ts:123,126,141` | 3 | fixture org |
| `packages/api/src/services/credentials.test.ts:315,317` | 2 | fixture org |
| `packages/shared/src/schemas/schemas.test.ts:433,435` | 2 | fixture org, inside protected `shared` |
| `packages/api/src/services/worktree-orchestrator.ts:219` + `.test.ts:302` | 2 | `SUNNY.md` — a personalised file from another workspace |
| `e2e/forensic/findings-template.md:8` | 1 | hardcoded `sspartorg/mono-repo` SHA command |
| `docs/adr/0011-*.md:10` | 1 | cites `C:\Users\sspart\.claude\plans\…`, unopenable by any reader |
| `packages/web/src/components/AssigneePickerPopover.test.tsx:217,234` | 2 | `owner_name: 'Sunny'` |
| `packages/web/src/components/AgentSelect.test.tsx:44,49,118,127` | 4 | `ownerName="Sunny"` |
| `packages/web/src/pages/dashboard/greetingMessages.ts:4-6` | 3 | illustrative comments naming the Owner |
| `docs/campaigns/2026-09-20-*/` | many | `dhequest*`, `neel-postgres`, `shopping-site_*`, `Sairam`, `/Users/sunnysabhanam/…` |

## What to do

1. **Rewrite the two source comments to state the technique, not the source.**
   A co-author trailer shape and "assign the human as PR assignee" are the
   useful facts; whose playbook they came from is not. Keep the WHY, drop the
   attribution.
2. **Fixtures → `acme-org`**, matching the `acme.atlassian.net` convention the
   Jira fixtures already use consistently. One name, everywhere, so the next
   reader learns the convention rather than guessing.
3. **`SUNNY.md` → a generic description** of what it is: a file the setup script
   regenerates on every provision. That is the behaviour the comment exists to
   explain.
4. **Neutral fixture name** for `Sunny` in the two web test files and the three
   `greetingMessages.ts` comments.
5. **Drop the hardcoded `sspartorg/mono-repo` command** from the forensic
   findings template.
6. **Replace the Windows plan-file citation** in ADR 0011 with a summary of the
   decision it was citing. An ADR that sources itself to an untracked file on
   someone else's machine is not an ADR.
7. **Redact the predecessor's campaign docs** — third-party stack names, the
   colleague's name, and absolute home paths become generic placeholders.

## Traps

- **`checklists/reset-inventory.md` is a safety rail, not prose.** It is the
  file that stops a future reset from pruning four unrelated Docker stacks off
  this host. Redact the *names* while keeping every DROP/KEEP decision and its
  reasoning intact and still actionable. If redaction would make a rule
  ambiguous, keep the rule readable and generalise differently.
- `packages/shared/src/schemas/schemas.test.ts` is inside the protected package.
  E-4 covers a **test-file fixture rename only**. A type change stops and asks.
- **Leave alone**: `sspart` / `sspartorg` (this product's own org, explicitly
  out of scope in the predecessor), `sspart.org@gmail.com` (E-6), the deliberate
  `CER -> ATL` WHY comment at `_keys.test.ts:26`, and `acme.atlassian.net`.
- `rg -i cer` returns ~121 substring hits — `certificate`, `cancel`, `reducer`,
  `placer`. Anchor on word boundaries or the sweep drowns.

## Done when

- [ ] `rg -i 'isw-cdm-next|cdmnext'` → 0 hits outside this campaign's audit trail
- [ ] `rg -i 'SUNNY\.md'` → 0 hits
- [ ] `rg -i 'dhequest|neel-postgres|shopping-site|Sairam'` → 0 hits outside this trail
- [ ] `rg -F '/Users/sunnysabhanam'` → 0 hits in tracked files
- [ ] `rg -F 'C:\Users\sspart'` → 0 hits
- [ ] `sspart.org@gmail.com` still present in `HelpAboutTab.tsx` (E-6 — this is a negative check)
- [ ] Full test suite green; no fixture rename broke an assertion on the old string
- [ ] G-001 and G-002 flipped in `findings.md`, board row flipped

## Evidence

_Written after execution._
