# 17 — Name cleanup: CER, DHEQ and JDA all become ATL

**Status:** todo
**Depends on:** nothing — can run in parallel with the walk
**Scope:** shared · api · web · docs

## Why

The Owner asked for leftover references to be replaced with neutral examples.
Two of the three named strings do not exist in this repo:

- **"Linoes"** — 0 hits.
- **"insightsoftware"** (and "insight software", "insight-software") — 0 hits.

Both were searched across the working tree, every gitignored directory
(`e2e-logs/`, `logs/`, `.atlas-dump/`, `.playwright-mcp/`, `test-results/`,
`playwright-report/`), all commit messages on all branches, and every blob in
`git rev-list --all`. Nothing to remove.

What does exist is three example issue-key prefixes used in comments, tests and
one placeholder. Ruling D-3: all three become **`ATL`**.

`sspart` / `sspartorg` is **not** in scope — it is this product's own GitHub
org, and it appears legitimately in `NOTICE`, `.github/CODEOWNERS`, `README.md`
and `HelpAboutTab.tsx`. Do not touch it. Likewise "horizon", which is almost
entirely the CSS sense of the word.

## The inventory

**`CER` — 34 lines.** The only one a user ever sees is
`packages/web/src/pages/projects/NewProjectModal.tsx:487` (`placeholder="CER"`).

| Where | Files |
|---|---|
| shared | `src/types/index.ts:294`, `src/schemas/index.ts:328`, `src/schemas/schemas.test.ts:179,182` |
| api | `src/main.ts:30,49,97`, `src/routes/comments.ts:110`, `src/services/_keys.test.ts:26,28,30` |
| mcp | `src/tools/items.test.ts:224,226` (`CER_Stories`) |
| web | `NewProjectModal.tsx:487`, `Projects.tsx:99`, `DetailsRailCard.tsx:39`, `hooks/useIssues.ts:8`, and seven dashboard test files |
| docs | `.agents/pages/02-projects.md:23` |

**`DHEQ` — 61 lines**, all Jira fixtures: `services/jira-sync.test.ts` (47),
`db/jira-sources-migration.test.ts` (10), `settings/JiraTab.test.tsx` (3),
`settings/JiraTab.tsx` (1).

**`JDA` — 6 lines**, alongside `cer-weekly-automation` in
`packages/shared/src/schemas/index.ts:328` and nearby.

Also rename the lowercase agent-slug examples: `cer-weekly-automation` →
`atl-weekly-automation` (`schemas/index.ts:328`, `routes/comments.ts:110`).

## What to do

1. **Check the shared constraint before starting.** `packages/shared` is
   protected (AGENTS.md hard rule 1). This task touches four `shared` lines:
   two comments (`types/index.ts:294`, `schemas/index.ts:328`) and two test
   assertions (`schemas.test.ts:179,182`). Comments and tests carry no runtime
   contract, so this is within the spirit of the rule — but record the
   justification in the commit body rather than assuming it.

2. **Do not blind-replace.** `\bCER\b` as a word boundary is safe, but `cer`
   lowercase appears inside `cer-weekly-automation` and would also match inside
   unrelated words. Use a word-boundary-anchored, case-sensitive pass for the
   uppercase prefixes, then handle the two lowercase slugs by hand.

3. **Preserve the case convention that a test asserts.**
   `schemas.test.ts:182` asserts `IssueKeyPrefixSchema.safeParse('cer').success === false`
   — lowercase must stay rejected. After renaming, that line must read `'atl'`,
   not `'ATL'`, or it stops testing anything.

4. **Keep the numeric suffixes.** `CER-7` → `ATL-7`, not `ATL-1`. Several
   tests depend on distinct ids within one file (`CER-T1` / `CER-S1` in the
   dashboard panel tests distinguish a Task row from a sub-task row).

5. **`main.ts`'s comments are incident history.** Lines 30, 49 and 97 reference
   a real past incident ("killed CER-4 / CER-5 mid-stream"). Renaming them to
   `ATL-4 / ATL-5` keeps the sentence readable, which is the point — these are
   WHY comments, and the ids are illustrative.

6. **Update `.agents/pages/02-projects.md:23`** in the same change — the
   self-update rule covers a doc whose example no longer matches the
   placeholder it documents.

7. **Verify no new collision.** `ATL` must not clash with the prefix the
   fixture project uses. [Task-06](task-06-project-two-repos-setup-secrets.md)
   already claims `ATL` for `atlas-demo` — that is intentional and makes the
   docs and the running app agree, which was the point of the ruling.

## Done when

- [ ] `grep -rnE '\bCER\b' --exclude-dir=node_modules --exclude-dir=.git
      --exclude=pnpm-lock.yaml .` returns 0 — paste the command and its output
- [ ] The same for `\bDHEQ\b` and `\bJDA\b`
- [ ] `grep -rn 'cer-weekly-automation'` returns 0
- [ ] `grep -rni 'linoes\|insightsoftware'` returns 0 (it already did — paste
      it as the record that it was checked, not fixed)
- [ ] `sspart`, `sspartorg` and the `horizon` CSS usages are **untouched** —
      paste a count showing they are unchanged from before the task
- [ ] `schemas.test.ts` still asserts a lowercase prefix is rejected, now
      with `'atl'`
- [ ] `pnpm -r test` green — paste the tail
- [ ] `pnpm typecheck` and `pnpm lint` clean
- [ ] `.agents/pages/02-projects.md` shows `ATL`
- [ ] The commit body records the justification for touching `packages/shared`

## Evidence

*(filled during execution)*
