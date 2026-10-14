# 0030. Budget What a Visit Downloads: Initial 230 KB, Total 900 KB

**Date:** 2026-10-14
**Status:** Accepted

## Context

A cold dashboard visit on Lighthouse's "slow 4G" profile (1.6 Mbps down, 150 ms RTT, 4x CPU, 390 px phone viewport), served the way production serves it (`pnpm start` → `vite preview`), downloaded **1,279 KB** before the network went idle at 8.0 s:

| Item | KB | Why |
| --- | --- | --- |
| Material Symbols icon font | 529 | The whole font for the ~180 icons the app uses |
| `GET /api/run?limit=500` | 178 | The header mascot paged 500 runs to find the live ones |
| `GET /api/agents` | 111 | 90 KB of it was every agent's `prompt_md`; the dashboard shows none |
| JavaScript | 360 | `zod`, the shared schemas and a dozen page components rode in the startup chunk |
| Text fonts | 78 | Inter, JetBrains Mono |

A repeat visit still moved 299 KB (the two API calls) and re-validated every asset, because `vite preview` serves hashed files with `Cache-Control: no-cache`.

The budget gate only ever saw the JavaScript line, and its total-size number counts every lazy page added together, which no visit downloads.

## Decision

1. **Subset the icon font** to the names in `packages/web/src/theme/icons.ts` via Google Fonts `icon_names=` (529 → 26 KB). `icons.test.ts` scans the web and API sources against Google's name list (`packages/web/scripts/material-symbols-rounded.names`) and fails on a used-but-missing icon; data-driven glyphs go through `iconOr()` so an unknown one falls back instead of rendering as text.
2. **Ask the API for what the screen shows**: `GET /api/run?status=queued,in_progress` for live runs and `GET /api/agents?view=summary` (no `prompt_md`) for the dashboard. Response shapes are unchanged subsets; `@atlas/shared` is untouched.
3. **Defer the decorative mascot** (lottie player + JSON) until after `load`, when the browser is idle.
4. **Serve assets as production should**: the build writes a Brotli copy of each JS/CSS asset; preview serves it to `br` clients and marks `/assets/*` `immutable` (the names carry a content hash). `index.html` stays `no-cache`.
5. **Let the bundler drop unused modules** behind our barrels: `treeshake.moduleSideEffects` is false for `packages/web/src` and `packages/shared/src` (CSS excepted). Nothing in either is imported for side effects only.
6. **Re-set the budgets around what a visit downloads**: `BUDGET_INITIAL_GZ` 264 → **230 KB** (measured 223.0 KB), locking in the startup cut; `BUDGET_TOTAL_GZ` 880 → **900 KB** (measured 894.3 KB).

Result, same profile: cold **1,279 → 416 KB**, network idle **8.0 → 3.7 s**, first contentful paint 2.0 → 1.4 s, LCP 2.8 → 2.4 s. Repeat visit **299 → 27 KB**, first paint 0.71 → 0.26 s.

## Why the total goes up

Step 5 moved code out of the one startup chunk into the lazy chunks of the pages that use it (`zod` now loads only on pages that validate). The modules are not duplicated — each is in exactly one chunk — but 31 more chunks each carry their own import/export glue and compress without the shared dictionary the single chunk had: +14 KB gz summed over every page, while the startup set every visit pays fell 36 KB. A budget that rose by the overhead is the honest reading; holding 880 would have meant keeping `zod` in everyone's startup download.

Alternatives considered:

- **Merge small shared chunks** (`codeSplitting` groups / `minSize`) — deferred. 59 chunks are under 1 KB, but a merge group either re-bundles them into a chunk most pages load (undoing the startup cut) or needs per-route tuning; measure navigation cost first.
- **Drop JetBrains Mono for the system monospace stack** (−31 KB, −1 request) — not taken here; `packages/web/AGENTS.md` names it for IDs. An Owner call.
- **Lazy-load the shell's dialogs and drawers** to take `mui-feedback` / `mui-form` / `mui-icons` (36 KB) out of startup — deferred; the Topbar's Tooltip keeps `mui-feedback` in startup unless the MUI buckets are re-cut too.

## Consequences

- An icon added in code but not in `ICONS` fails `icons.test.ts` with its name.
- The budget gate now guards the number users feel: a change that pulls page code back into startup trips the 230 KB initial budget.
- Production keeps being served by `vite preview`; a different server must replicate the Brotli + `immutable` rules for `/assets/*`.
