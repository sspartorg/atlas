import { defineConfig, devices } from '@playwright/test';

// 2026-06-11 — Forensic-audit Playwright config.
//
// Targets the LIVE dev stack (http://localhost:4000) instead of the
// hermetic e2e stack on :6000. The audit needs the user's real
// `mono-repo` project + MON-N epic visible at /epics/<key>, and
// pg_stat_statements running on the dev DB — none of which exist in
// the e2e env.
//
// Owner must have `pnpm dev` running before invoking
// `pnpm e2e:forensic`. The config deliberately omits `globalSetup`
// / `globalTeardown` so it cannot stomp on dev DB state.
//
// Output: e2e-logs/forensic-<ts>/forensic.ndjson + screenshots/.

export default defineConfig({
    testDir: './e2e/forensic',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env['CI']),

    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-forensic-report', open: 'never' }],
    ],

    use: {
        baseURL: 'http://localhost:4000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
        ignoreHTTPSErrors: true,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
