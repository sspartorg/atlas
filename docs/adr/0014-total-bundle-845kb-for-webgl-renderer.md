# 0014. Raise the Total-App Budget to 845 KB gz for the WebGL Terminal Renderer

**Date:** 2026-08-11
**Status:** Accepted

## Context

`aa9c432 perf(web): cut 62 KB gz from the bundle to get back under budget` (2026-08-04) removed `@xterm/addon-webgl` from `packages/web`. The reasoning recorded in `TerminalXterm.tsx` was that the addon "was never load-bearing: it was wrapped in a try/catch for GPUs without WebGL, and disposed on context loss, both of which already fell back to exactly this renderer. Output is identical; only heavy-scrollback repaint is slower."

That reasoning was wrong on Windows, and the review that accepted it ran on macOS.

The addon was added on 2026-07-13 for a specific, named defect: *"Windows Chrome scrolling artifacts where first 2 chars of lines leave 'trails' during scroll."* Chrome and Edge on Windows leave the leading glyphs of a line painted at their old position while the text beneath scrolls away, and the residue compounds the further you scroll. macOS shows none of it — the same code renders clean — so the platform that exhibits the bug is the one nobody tested before removing the mitigation.

Two commits, together, removed every defence:

- `f9a4ed7 fix(terminal): replay serialized screen state instead of raw byte backlog` (2026-08-01) removed the software mitigations — a scroll-triggered `term.refresh()`, GPU-hint canvas CSS, and `scrollOnUserInput: false` — reading them as redundant to its own fix. They were not. That commit fixed *malformed bytes* (replays beginning mid-escape-sequence). This defect is *correct bytes painted stale*. Both had been filed under the same "zombie characters" label, which is how they got conflated.
- `aa9c432` (2026-08-04) then removed the WebGL renderer, which had been silently masking the defect on its own.

After 2026-08-04 nothing mitigated it. Windows users report both symptoms the renderer had been covering: glyph trails that worsen as you scroll, and slow repaint of a deep scrollback — the latter exactly as the removing commit predicted, but filed as acceptable.

Measurements on this branch:

| | baseline | with addon | budget |
|---|---|---|---|
| Initial chunk | 260.1 KB gz | 260.1 KB gz | 264 KB |
| Total app | 802.5 KB gz | 835.6 KB gz | 830 KB |

The addon costs **33.1 KB gz**, not the 65.6 KB the removing commit recorded. It is loaded with a dynamic `import()` after `term.open()`, so it lands in its own `addon-webgl-*.js` chunk and the initial route chunk is byte-identical — only a user who opens a Terminal downloads it.

Alternatives considered:

- **Restore the scroll-triggered `term.refresh()` instead (0 KB)** — rejected. It repaints the full viewport every scroll frame on the core renderer, which is precisely the renderer users report as already slow. It would trade one reported symptom for a worse case of the other. It also treats the symptom: the defect is that the renderer does not clear cells, and forcing whole-viewport redraws is a workaround layered over that.
- **Reclaim the 5.6 KB elsewhere first** — deferred, not rejected. `index.umd-*.js` (48.9 KB gz) is a UMD build of the diff library feeding the Stop-modal review; a UMD bundle carries its own AMD/CommonJS shims and resists tree-shaking, so moving it to an ESM entry plausibly frees more than the addon costs. That is a separate change with its own risk surface and its own verification, and holding a correctness fix on Windows behind it is the wrong ordering.
- **Ship it over budget** — rejected, for the reason ADR 0013 gives: a red gate on `main` teaches everyone to ignore it.

## Decision

Raise `BUDGET_TOTAL_GZ` from 830 KB to 845 KB gz in `packages/web/scripts/check-bundle-budget.mjs`, leaving ~9.4 KB of headroom over the measured 835.6 KB.

Restore `@xterm/addon-webgl` as a lazy dynamic import in `TerminalXterm.tsx`, keeping the existing `onContextLoss` disposal and a `.catch()` so hosts without WebGL fall back to xterm's core renderer unchanged.

Keep `BUDGET_INITIAL_GZ` at 264 KB. It is untouched by this change and remains the budget that governs first paint.

## Consequences

- Windows Chrome/Edge get correct scroll rendering and GPU-accelerated repaint. macOS behaviour is unchanged; it was already correct.
- Users who never open a Terminal download nothing extra. The 33 KB chunk is fetched on first Terminal open and cached thereafter.
- Total-app headroom goes from 27.5 KB to 9.4 KB. Tighter than the ~5 KB-per-bucket convention is comfortable with, which makes the `index.umd` swap the natural next reclamation rather than an optional cleanup.
- The renderer choice is now load-bearing and documented as such in `TerminalXterm.tsx`. Dropping the addon again re-opens a defect that is invisible to anyone testing on macOS — the comment says so explicitly, because the last two attempts to simplify this were both made in good faith with the same blind spot.
- No automated test guards this. It is a GPU rasterisation artifact on one platform's browsers; it cannot be reproduced in jsdom, in CI, or on the maintainers' macOS machines. The guard is the comment and this ADR.
