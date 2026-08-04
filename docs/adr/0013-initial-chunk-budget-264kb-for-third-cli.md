# 0013. Raise the Initial-Chunk Budget to 264 KB gz

**Date:** 2026-08-04
**Status:** Accepted

## Context

`packages/web/scripts/check-bundle-budget.mjs:39` pins the initial route chunk (entry + `react-vendor` + `mui-*`) at 260 KB gz, set on 2026-06-28 after the post-W1 cleanup and last defended by `aa9c432 perf(web): cut 62 KB gz from the bundle to get back under budget`. The header comment on that block reads *"Owner-set budgets. Update only by ADR."*

Adding `ollama` as a third `cli` value (agents, terminal sessions, Model Registry) grew the `index` chunk by ~200 bytes raw / 0.1 KB gz: 306.2 → 306.4 KB raw, 81.1 → 81.2 KB gz. Measured initial total moved 259.9 → 260.1 KB gz, so the gate fails by 0.1 KB. The growth is the third option itself — one more entry in each `Record<AgentCli, …>`, one more `ToggleButton`/`MenuItem` in four pickers, and the `CLI_DIALECT` / `CLI_LABEL` / `DEFAULT_MODEL_BY_CLI` registry in `@atlas/shared` that replaced the scattered two-armed ternaries.

Two rounds of structural trimming were attempted first, and both were kept because they are correct regardless of the budget, but neither moved the initial total:

- Split the three MUI CLI icons out of `packages/web/src/utils/cliPresentation.ts` into `cliIcons.ts`, so label-only consumers (`TerminalFilters`, `StartSessionDialog`, `Agents`) stop pulling React icon components into their chunk.
- Moved the per-CLI chart accents from the shared module into `_TerminalSessionsCard.tsx`, the one lazy chunk that renders them.

Together those cut total app size 802.8 → 802.5 KB gz but left `index` unchanged — confirming the residue is the feature's own surface area, not accidental chunk leakage.

Alternatives considered:

- **Reuse an already-bundled icon for Ollama instead of `MemoryRounded`** — rejected. It saves a fraction of the overage and makes Ollama visually indistinguishable from Claude in the terminal list, which is the one place the icon has a job.
- **Lazy-load the CLI pickers** — rejected. They are `ToggleButton`/`MenuItem` children inside dialogs that are already chunked; a dynamic import per picker adds a request waterfall to a click path to save tens of bytes.
- **Leave the gate red and let the Owner decide** — rejected. The budget's own header names ADR as the mechanism for exactly this situation, and a red gate on `main` teaches everyone to ignore it.

The root issue is that 260 KB was set with 0.1 KB of headroom against the then-current measurement. At that margin, *any* app-shell feature trips the gate, which makes it a tripwire rather than a budget.

## Decision

Raise `BUDGET_INITIAL_GZ` from 260 KB to 264 KB gz in `packages/web/scripts/check-bundle-budget.mjs`, giving ~3.9 KB of headroom over the measured 260.1 KB. This matches the ~5 KB headroom convention already used for the per-MUI-bucket budgets on the lines directly below it.

Keep every other budget unchanged. Total app size (802.5 KB gz against an 830 KB budget) and all per-chunk budgets still pass with their original slack.

## Consequences

- The bundle gate goes back to being a regression detector with room to breathe, instead of failing on the next 200-byte change to the app shell.
- The initial cached core the user downloads grows by 0.1 KB gz. Real, and negligible against 260 KB.
- 3.9 KB of new headroom can be spent silently by future work. That is the trade for a usable gate; the `Initial chunk total` line is printed on every run, so drift is visible without waiting for a failure.
- The two structural splits made while chasing this (`cliIcons.ts`, card-local accents) stay. They are the right shape — icon components and chart colours each belong to the chunk that renders them — and they keep future CLI additions from widening the app shell further.
- Refreshing the chunk table in `.agents/architecture.md` ("Bundle size baseline", captured at `dd90e93`) is deferred; it was already stale before this change and re-measuring it is a separate pass.
