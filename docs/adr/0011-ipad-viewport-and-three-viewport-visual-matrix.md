# 0011. iPad Viewport and Three-Viewport Visual Matrix

**Date:** 2026-07-01
**Status:** Accepted

## Context

The Atlas Playwright stack ran two browser projects: `chromium` (Desktop Chrome via `devices['Desktop Chrome']` ≈ 1280×720) and `mobile-chrome` (Pixel 7 412×915). Visual regression snapshots covered only the desktop project (`e2e/visual/snapshots.spec.ts`), captured 16 routes × 2 themes = 32 baselines, and the mobile/iPad surfaces were entirely uncovered.

The coverage-push-v2 master plan (`C:\Users\sspart\.claude\plans\i-have-a-very-jolly-marshmallow.md` T7) called for a three-viewport matrix to catch tablet-only regressions: sidenav adaption, table fit, modal overflow, and touch-target sizing. The agreed viewports were 1920×1080 desktop / 390×844 mobile (iPhone 14/15 portrait) / 834×1194 iPad portrait.

Alternatives considered:
- **Webkit for iPad** — most authentic Safari emulation, but introduces a second browser engine, doubling artifact size on every CI run and surfacing engine-level rendering differences that are not the design target.
- **Tablet-Chromium only** — chosen. Engine parity with the desktop and mobile projects means a snapshot diff genuinely reflects layout-matrix bugs, not browser-engine drift.
- **Single project with explicit `viewport` per-test** — rejected because per-spec viewport overrides interact badly with `expect.toHaveScreenshot` baseline keys (Playwright stores one baseline per project, not per viewport size).

## Decision

Add a third Playwright project, `ipad-chrome`, at `viewport: { width: 834, height: 1194 }`, `deviceScaleFactor: 2`, `hasTouch: true`, `isMobile: false`, Chromium engine. Update the existing `chromium` viewport to an explicit `{ width: 1920, height: 1080 }` and `mobile-chrome` to `{ width: 390, height: 844 }`. Specs tagged `@mobile` or `@ipad` in their title run on the matching project; the `chromium` project gets `grepInvert: /@mobile|@ipad/` so it does not also run mobile-shell-targeted assertions at desktop width.

Expand `e2e/visual/snapshots.spec.ts` to capture (24 routes + 3 modal-open scenarios) × 2 themes (light/dark) × 3 projects ≈ 162 baselines on the first Linux-CI seed. All tests tagged `@mobile @ipad` so each project picks them up via its grep filter; the `chromium` project runs everything else by virtue of having no `grep`.

## Consequences

- Tablet-only regressions (table horizontal overflow, modal viewport fit, sidenav collapse boundary at MUI `md`) are caught by CI before they ship.
- 834px falls below MUI's `md` breakpoint (900px), so the iPad portrait shell renders BottomNav + MoreSheet rather than the permanent inline Sidenav. Documented in `e2e/responsive/ipad.spec.ts`. Tests reflect this layout — the MoreSheet IS the nav surface accessible to iPad-portrait users in this codebase.
- Baseline storage grows ~5×: from 32 to ~162 PNGs (Linux-only; committed under `e2e/visual/__snapshots__/` on first `--update-snapshots` CI seed).
- The `chromium` project's new `grepInvert: /@mobile|@ipad/` is non-negotiable; without it, mobile-shell assertions (BottomNav presence, etc.) run at 1920×1080 and fail because the desktop shell does not render BottomNav.
- Mobile viewport bumped from Pixel 7 (412×915) to iPhone 14/15 (390×844) — slight regression risk if a CSS rule was tuned for 412 width. Visual diff catches any breakage.
- Desktop viewport bumped from 1280×720 to 1920×1080 — pages laid out for narrower widths render with more whitespace; not a defect, but the baseline reset reflects this.
