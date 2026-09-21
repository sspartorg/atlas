# 07 — Recapture the twelve stale guide screenshots

**Status:** todo
**Depends on:** task-02
**Scope:** docs

## Why

G-005. `docs/guide/README.md` documents fifteen sections against fifteen images.
Only `doc-13`, `doc-14` and `doc-15` were captured after the factory reset;
`doc-01` through `doc-12` predate it and show the retired sandbox project under
its old issue-key prefix. A sixteenth problem: `doc-02-dashboard-empty.png` is
tracked but referenced nowhere.

The predecessor's task-20 is the most honest row on its board — it rewrote the
guide's prose, kept the stale images rather than shipping a guide with no
pictures, and left its own screenshot checkbox unticked with the reason written
down. This row finishes it.

Depends on task-02 because a screenshot taken before the name sweep would
capture the old names into a binary that the sweep cannot grep.

## What to do

1. **Revisit the generator decision.** The predecessor rejected adapting
   `e2e/forensic/walkthrough.spec.ts` because it writes to gitignored
   `e2e-logs/`. That spec already screenshots every route in both themes, and
   it honours an `OUT_DIR` override. A one-off override pointed at
   `docs/guide/images/` is cheaper than twelve manual captures and makes the
   next refresh free. If it genuinely cannot produce guide-quality framing,
   capture by hand and record *why* so the next person does not re-litigate it.
2. Recapture `doc-01` … `doc-12` against the current build.
3. Resolve `doc-02` — reference it from the README or delete it.
4. Fix `README.md:463-464`, which describes a repo directory as a "Confluence
   page [that] carries the same content with screenshots". No such page exists.

## Traps

- **Hard rule 6.** `docs/guide/images/` is the *only* tracked image path.
  Nothing from `e2e-logs/`, `docs/visual-audit/`, `test-results/` or any
  `*-screenshots/` directory gets committed, whatever the generator writes.
  Eyeball staged and untracked entries before `git add`.
- Screenshots taken on a machine with real credentials can capture a token, a
  repo URL or a path. Check each image before staging — this is the same class
  of problem as G-001 and the repo is still public.
- The app is on ports **4100/4101** here, not the documented 4000/4001.

## Done when

- [ ] `doc-01` … `doc-12` recaptured against the current build
- [ ] Every image referenced by `README.md` resolves; no orphans remain
- [ ] No image shows a retired project name, a token, or an absolute home path
- [ ] `README.md:463-464` corrected
- [ ] The generator decision is recorded either way
- [ ] Nothing outside `docs/guide/images/` was staged
- [ ] G-005 flipped in `findings.md`, board row flipped

## Evidence

_Written after execution._
