import { defineConfig, devices } from '@playwright/test';

// Perf + visual harness config. Unlike `playwright.config.ts` it owns no
// stack: point it at one started by `scripts/perf-stack.sh up` (a production
// web build over an API on the large `atlas_perf` seed).
//
//   PERF=1 PERF_LABEL=before pnpm exec playwright test -c playwright.perf.config.ts
//
// Visual baselines live under e2e-logs/visual/ (gitignored): run once with
// `--update-snapshots` for the "before" side, then without it for "after" —
// Playwright's own screenshot diff reports every route that changed.

const BASE_URL = process.env['PERF_BASE_URL'] ?? 'http://localhost:4700';

export default defineConfig({
    testDir: './e2e/perf-harness',
    testMatch: /(scroll-and-load|visual-compare)\.spec\.ts/,
    timeout: 180_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list'], ['html', { outputFolder: 'e2e-logs/perf-report', open: 'never' }]],
    snapshotPathTemplate: 'e2e-logs/visual/baseline/{arg}{ext}',
    expect: {
        toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2, animations: 'disabled' },
    },
    use: { baseURL: BASE_URL, trace: 'off', screenshot: 'off', video: 'off' },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
        { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@visual/ },
    ],
});
