import { defineConfig, devices } from '@playwright/test';

// Playwright E2E config.
//
// Stack-up is owned by `e2e/global-setup.ts`: it drops + creates
// `atlas_e2e` (on the dev postgres container, host port 5500),
// runs Knex migrations, seeds, then spawns the API on :6001 + the
// Web dev server on :6000 with `VITE_API_BASE_URL` pointing at the
// test API. `global-teardown.ts` kills both processes and the e2e
// DB (state lives on disk between runs only when the snapshot
// battery is rebuilt).
//
// `fullyParallel: false` + `workers: 1` because the test DB is
// shared single-instance state — parallel specs would step on each
// other's truncate / seed cycle. If we ever want per-spec
// parallelism we'll need per-worker test DBs.

export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: {
        timeout: 10_000,
        // W9 — snapshot fuzz tolerance for `toHaveScreenshot`. MUI
        // anti-aliases slightly differently across runners; 0.2% diff
        // absorbs that noise without hiding real visual regressions.
        // Baselines are Linux-only — see e2e/visual/README.md.
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.002,
            threshold: 0.2,
            animations: 'disabled',
        },
    },
    fullyParallel: false,
    workers: 1,
    retries: process.env['CI'] ? 1 : 0,
    forbidOnly: Boolean(process.env['CI']),

    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],

    use: {
        // 2026-06-23 — 6010, not 6000. 6000 is X11 on the WHATWG bad-ports
        // blocklist (Chromium blocks ERR_UNSAFE_PORT, Node fetch refuses
        // it). Kept in sync with WEB_PORT in `e2e/global-setup.ts`.
        baseURL: 'http://127.0.0.1:6010',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
        // Snapshot fuzz tolerance — atlas's UI uses MUI which
        // anti-aliases differently across machines. 0.2% diff
        // absorbs the noise without hiding real visual regressions.
        ignoreHTTPSErrors: true,
    },

    projects: [
        // Desktop FHD — primary suite target. The Atlas app shell is
        // designed for ≥1440 wide; 1920×1080 matches the most common
        // production resolution and gives every page-level layout room
        // to render its full sidebar + main + rail composition.
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
            },
            // Chromium is the desktop project — exclude any spec explicitly
            // tagged for the mobile or iPad projects. Without this filter,
            // tests with `@mobile` / `@ipad` in their titles ALSO run here
            // (they assert mobile-shell selectors that don't exist at 1920×1080)
            // and would always fail. The mobile-chrome / ipad-chrome projects
            // pick them up via their own `grep` filters.
            grepInvert: /@mobile|@ipad/,
        },
        // Mobile portrait — iPhone 14/15 sized. Layout-sensitive specs
        // tagged `@mobile` exercise BottomNav, MoreSheet, and the mobile
        // list variants (MobileEpicList, MobileWorkItemList).
        {
            name: 'mobile-chrome',
            use: {
                ...devices['Pixel 7'],
                viewport: { width: 390, height: 844 },
            },
            grep: /@mobile/,
        },
        // iPad portrait — between the desktop and mobile breakpoints.
        // Catches tablet-only regressions: sidenav stays expanded (no
        // BottomNav fallback), tables fit without horizontal scroll,
        // modals fit within the viewport. Chromium engine for
        // engine-parity with the other two projects — this catches
        // layout-matrix bugs, not browser-engine bugs. Specs tagged
        // `@ipad` run here.
        {
            name: 'ipad-chrome',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 834, height: 1194 },
                deviceScaleFactor: 2,
                hasTouch: true,
                isMobile: false,
            },
            grep: /@ipad/,
        },
    ],
});
