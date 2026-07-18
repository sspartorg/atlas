# Visual snapshot baselines (W9)

Visual snapshots live under this directory's `__snapshots__/`. Playwright
suffixes each baseline with the platform name (e.g.
`light--projects.png-linux.png`), so different OSes never collide.

## Why Linux-only

The MUI render path produces sub-pixel differences between macOS, Windows,
and Linux Chromium that aren't real visual regressions. To keep the
baseline directory single-platform, the suite at `snapshots.spec.ts`
guards with `test.skip(!process.env['CI'], ...)`. Local dev runs don't
participate; CI on `ubuntu-latest` does.

## Seeding the baseline

First-time seed needs the `--update-snapshots` flag on a Linux runner:

```bash
# In CI, on ubuntu-latest, after `pnpm install` + `pnpm exec playwright install --with-deps chromium`:
pnpm e2e --update-snapshots e2e/visual/
git add e2e/visual/__snapshots__/
git commit -m "test(e2e): seed visual baselines (W9 chunk 1)"
```

The artifact step in `.github/workflows/e2e.yml` (or a dedicated visual
workflow) commits the `__snapshots__/` directory back. Subsequent runs
gate via `toHaveScreenshot()` against those baselines, with the fuzz
tolerance set in `playwright.config.ts` (`maxDiffPixelRatio: 0.002`,
`threshold: 0.2`, animations disabled).

## Updating a baseline intentionally

When a UI change is intentional (palette tweak, layout refactor,
copy update), regenerate by re-running with `--update-snapshots` on
Linux and committing the new images. The PR description must call out
the visual diff for human review.

## Not included in chunk 1

- Mobile snapshots (`@mobile`-tagged routes under `mobile-chrome`
  project). Needs a separate file with the mobile route list + the
  device dimensions baked into snapshot names.
- Modal-open states. Right now snapshots capture page-load layout
  only; per-modal screenshots come from later spec authoring.
- Component-level isolated snapshots (Storybook-style). Out of scope
  for the e2e visual gate.
