import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { setThemeMode, type ThemeMode } from '../helpers/theme.js';
import { ROUTES } from './routes.js';

// Visual before/after for the heavy routes, both themes, desktop + mobile.
// Local only — baselines are machine-specific and live in e2e-logs/visual/
// (gitignored); CI stays build-only.
//
//   before:  PERF=1 PERF_LABEL=before pnpm exec playwright test -c playwright.perf.config.ts visual --update-snapshots
//   after:   PERF=1 PERF_LABEL=after  pnpm exec playwright test -c playwright.perf.config.ts visual
//
// A failing "after" test IS the report: Playwright writes expected/actual/diff
// PNGs for every route whose pixels moved. Each run also keeps plain
// screenshots under e2e-logs/visual/<label>/ for side-by-side review.

const PERF_ENABLED = process.env['PERF'] === '1';
const LABEL = process.env['PERF_LABEL'] ?? 'run';
const THEMES: ThemeMode[] = ['light', 'dark'];

test.describe('visual @visual', () => {
    test.skip(!PERF_ENABLED, 'PERF=1 not set');

    for (const route of ROUTES) {
        for (const theme of THEMES) {
            test(`${route.name} ${theme} @visual`, async ({ page }, info) => {
                await setThemeMode(page, theme);
                if (route.storage) {
                    await page.addInitScript((s) => {
                        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
                    }, route.storage);
                }
                await page.goto(route.path, { waitUntil: 'load' });
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
                if (route.prepare) await route.prepare(page);
                await page.waitForTimeout(1200);
                // Relative times ("4h ago") and live dots move between runs;
                // mask them so a diff means the layout changed.
                const mask = [page.locator('time'), page.locator('[data-live-dot]')];
                const file = `${route.name}-${theme}-${info.project.name}`;
                mkdirSync(`e2e-logs/visual/${LABEL}`, { recursive: true });
                await page.screenshot({ path: `e2e-logs/visual/${LABEL}/${file}.png`, mask });
                await expect(page).toHaveScreenshot(`${file}.png`, { mask });
            });
        }
    }
});
