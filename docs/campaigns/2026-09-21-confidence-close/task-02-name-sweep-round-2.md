# 02 — Leftover-name sweep round 2

**Status:** done — 2026-09-21
**Depends on:** task-01
**Scope:** api · shared · web · docs

## Why

G-001 and G-002. The predecessor's ruling D-3 swept for three names, found two
absent, renamed the third, and closed. Two really were absent. The third
company, though, was searched for by its **spelled-out name only** — and what
was actually in the tree was its abbreviated GitHub org slug paired with the
name of its internal commit bot. That pair survived the sweep nine times,
including two comments in shipping API source citing that company's internal
playbook as the stated rationale for Atlas's git-credential design.

`sspartorg/atlas` is **public**. That is what makes this P0 rather than
housekeeping, and it is also why **the retired strings appear nowhere in this
file**: a task document that quotes them verbatim keeps publishing precisely
what the task removes. The operator works from a local sweep list; what is
committed describes the shape of each hit and where it lived.

Ruling E-5 scopes the remedy: working tree and tracked docs only, no history
rewrite. The old commits stay readable and the verdict in task-10 says so.

## The inventory

| where | hits | what |
|---|---|---|
| `packages/api/src/services/git-credentials.ts:31` | 1 | comment crediting another company's bot for the co-author trailer shape |
| `packages/api/src/services/worktree-orchestrator.ts:1041` | 1 | comment citing that company's "playbook" as the PR-assignee rationale |
| `packages/api/src/services/github-app-tokens.test.ts:123,126,141` | 3 | fixture org |
| `packages/api/src/services/credentials.test.ts:315,317` | 2 | fixture org |
| `packages/shared/src/schemas/schemas.test.ts:433,435` | 2 | fixture org, inside protected `shared` |
| `packages/api/src/services/worktree-orchestrator.ts:219` + `.test.ts:302` | 2 | a personalised agent-instructions filename from another workspace |
| `e2e/forensic/findings-template.md:8` | 1 | hardcoded `sspartorg/mono-repo` SHA command |
| `docs/adr/0011-*.md:10` | 1 | cites `C:\Users\sspart\.claude\plans\…`, unopenable by any reader |
| `packages/web/src/components/AssigneePickerPopover.test.tsx:217,234` | 2 | the Owner's real given name as an `owner_name` fixture |
| `packages/web/src/components/AgentSelect.test.tsx:44,49,118,127` | 4 | the same, as an `ownerName` prop |
| `packages/web/src/pages/dashboard/greetingMessages.ts:4-6` | 3 | illustrative comments naming the Owner |
| `docs/campaigns/2026-09-20-*/` | many | `third-party-stack*`, `another-project-postgres`, `another project's resources`, `Alex`, `<home>/…` |

## What to do

1. **Rewrite the two source comments to state the technique, not the source.**
   A co-author trailer shape and "assign the human as PR assignee" are the
   useful facts; whose playbook they came from is not. Keep the WHY, drop the
   attribution.
2. **Fixtures → `acme-org`**, matching the `acme.atlassian.net` convention the
   Jira fixtures already use consistently. One name, everywhere, so the next
   reader learns the convention rather than guessing.
3. **The personalised filename → a generic description** of what it is: a file the setup script
   regenerates on every provision. That is the behaviour the comment exists to
   explain.
4. **Neutral fixture name** for the Owner in the two web test files and the three
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

The retired strings are **not listed here.** Writing them into the acceptance
criteria of a public repo would re-publish exactly what the task removes, and a
checklist that greps for its own placeholders passes vacuously. The operator
keeps the sweep list in local scratch notes; what is committed are the checks
that are meaningful to a reader who never saw the old names.

- [x] Every retired string sweeps to 0 hits in tracked files, from the local list
- [x] `git grep -nE '/Users/[a-z]+|C:\\Users\\'` → 0 hits in tracked files
      (absolute home paths, either platform — publishable because it names a
      *shape*, not a person)
- [x] The personalised agent-instructions filename → 0 hits
- [x] The reset checklist's KEEP section names **only Atlas resources**, and
      states the allowlist rule positively — verified by reading it, since an
      inverted list cannot be checked by grepping for what is absent
- [x] `sspart.org@gmail.com` **still present** in `HelpAboutTab.tsx` (E-6 — a
      negative check; this one must NOT be swept)
- [x] Full test suite green; no fixture rename broke an assertion on an old string
- [x] G-001 and G-002 flipped in `findings.md`, board row flipped

## Evidence

**Swept clean. 27 replacements across 13 files, every touched suite green:**
5 api files / 96 tests, `shared` schemas 129, the two web component specs 19.

### What the plan got wrong

**The reset checklist could not be redacted.** The plan said to "redact the
names while keeping every DROP/KEEP decision intact". That is not possible:
`checklists/reset-inventory.md:106-121` was a nine-row table enumerating
another project's containers, volumes and networks *by name*, and its whole
function is to let an operator check a name against a do-not-touch list.
Replace the names with placeholders and the rail stops working — you cannot
ask "is `foo-postgres` on the list?" of a list that reads
`third-party-stack-1-*`.

So the section was **inverted instead of redacted**: it now names the five
resources Atlas owns and states that everything else on the host is
untouchable. That is strictly safer than the original — a stack added to this
host tomorrow is protected automatically, where a denylist would silently fail
to cover it — and it names no third party at all. The redaction forced a
better document, which is not how redactions usually go.

**The acceptance criteria were self-defeating on the first pass.** The
`Done when` list originally grepped for the retired strings. Running the
redaction over this file rewrote those greps into their own placeholders, so
the checklist would have passed by searching for text it had just introduced.
Rewritten to check *shapes* — absolute home paths on either platform, the
personalised filename, the inverted KEEP section — and the literal strings now
live only in local scratch notes.

**The same trap applied to the findings file.** G-001's evidence cell quoted
the org slug verbatim. On a public repo that keeps publishing the exact string
the finding exists to remove, so the cell was rewritten to describe the hit
structurally and say plainly that the fix is verified by the sweep returning
zero, not by matching the old text. Consistency then forced the same edit
through `index.md`, `task-02`, and the predecessor's D-3 ruling and task-17.

### The one thing deliberately left

Two hits remain for `"Linoes"` — `task-17:12` and this board's `findings.md`.
Both are records stating the search was run and found nothing. There was never
anything to delete, and the name identifies no real party, so removing the
record would only erase the evidence that the check happened.

### Negative check held

`sspart.org@gmail.com` is **still present** twice in `HelpAboutTab.tsx`, as
ruling E-6 requires. A sweep that removed it would have been a regression, not
a cleanup.

### What E-5 leaves behind

The working tree is clean; **git history is not**. The retired strings remain
readable in 2 commits and this repo is public. That is the Owner's explicit
ruling, and task-10's verdict states it rather than implying the problem is
fully gone.
