import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// 2026-06-11 — Forensic-audit Playwright config.
//
// Targets the LIVE dev stack instead of the hermetic e2e stack on :6010.
//
// G-018/G-017 — the port is derived from `WEB_PORT`, the same variable the
// dev server and `utils/lan-origins.ts` read, rather than hardcoded. It was
// pinned to 4000 while this machine's `.env` had moved to 4100, and nothing
// failed: the suites just ran against whatever was listening on 4000. On
// 2026-09-21 that was a stale Vite server whose `/api/*` returned the SPA's
// HTML, so `state-transitions` reported 1 failed / 9 passed — a phantom
// failure, and nine meaningless passes, against an app that could not load
// its own data. A wrong port must not look like a test result.
// The audit needs the user's real project and Tasks visible at /tasks, and
// pg_stat_statements running on the dev DB — none of which exist in
// the e2e env.
//
// Owner must have `pnpm dev` running before invoking
// `pnpm e2e:forensic`. The config deliberately omits `globalSetup`
// / `globalTeardown` so it cannot stomp on dev DB state.
//
// Output: e2e-logs/forensic-<ts>/forensic.ndjson + screenshots/.

/**
 * The dev stack's web port, read from the root `.env`.
 *
 * Playwright does not load `.env`, so `process.env.WEB_PORT` is empty here
 * however the dev server is configured — which is why hardcoding 4000 went
 * unnoticed. Parsed directly rather than adding a dotenv dependency for one
 * value.
 */
function devWebPort(): string {
    const fromShell = process.env['WEB_PORT'] ?? process.env['PORT'];
    if (fromShell) return fromShell;
    try {
        const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
        return /^WEB_PORT=(\d+)/m.exec(env)?.[1] ?? '4000';
    } catch {
        return '4000';
    }
}

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
        baseURL: process.env['FORENSIC_BASE_URL'] ?? `http://localhost:${devWebPort()}`,
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
