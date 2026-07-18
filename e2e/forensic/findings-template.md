# Forensic Findings — `<run-label>`

> Replace `<run-label>` with the run identifier (e.g. `baseline-20260611-101530`,
> `orange-light`, `pineapple-dark`, `post-fix-20260612-093000`).

**Run timestamp**: <ISO-8601>
**Atlas SHA**: <git rev-parse HEAD>
**mono-repo SHA**: <gh api repos/sspartorg/mono-repo/commits/main --jq .sha>
**Theme(s)**: <light | dark | both>
**Walker**: `e2e/forensic/walkthrough.spec.ts` (Plan 1)
**Findings file**: `e2e-logs/forensic-<ts>/forensic.ndjson`
**Screenshots**: `e2e-logs/forensic-<ts>/screenshots/`
**EXPLAIN report**: `e2e-logs/baseline-<ts>/explain.txt`

---

## 1. Visual / design-principles findings

> Anything that breaks the Mercury palette, hardcoded colors that
> survive theme switch, contrast failures, broken alignment, etc.

| # | Route | Theme | Issue | Evidence | Severity | Owner action |
|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |

## 2. Performance findings

> nav_load_ms regressions, TTFB spikes, total_bytes growth, web vitals
> in `needs-improvement` or `poor`, API budget breaches.

| # | Route | Metric | Value | Budget | Delta | Notes |
|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |

## 3. Duplicate-network findings

> From `e2e/no-dup-fetches.spec.ts` failures or manual inspection of
> the forensic.ndjson `requests` arrays.

| # | Route | Duplicate request | Count within 100 ms | Owner action |
|---|---|---|---|---|
|   |   |   |   |   |

## 4. SQL / indexing findings

> From `e2e-logs/baseline-<ts>/explain.txt`. Look for: Seq Scan on
> large tables, missing index hints (cost vs rows), un-cached buffer
> reads (`shared_blks_read >> shared_blks_hit`).

| # | queryid | Calls | Mean ms | Plan signal | Recommendation |
|---|---|---|---|---|---|
|   |   |   |   |   |   |

## 5. Broken affordances

> Buttons that don't do anything, links to nowhere, modals that fail
> to open, tabs that crash. Anything user-facing that is broken.

| # | Route | Element | Expected | Actual | Severity |
|---|---|---|---|---|---|
|   |   |   |   |   |   |

## 6. Accessibility (deferred)

> Plan 1 does NOT scan a11y (axe-core not in pnpm-lock). Add in a
> later plan if needed.

## 7. Console errors

> Anything in `console_errors` from the ndjson that isn't a known
> noise source. Grep with:
>
>     jq -c 'select(.console_errors | length > 0)' forensic.ndjson

| # | Route | Theme | Error | Notes |
|---|---|---|---|---|
|   |   |   |   |   |

---

## Summary

- **Total routes visited**: <N>
- **Total tabs visited**: <N>
- **Total findings**: <N>
- **Blockers** (Sev=high): <N>
- **Nits** (Sev=low): <N>
- **Recommended next plan**: <plan name>
