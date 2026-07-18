import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gotoWithPerf } from '../helpers/perf.js';
import { setThemeMode, type ThemeMode } from '../helpers/theme.js';

// 2026-06-11 — Forensic walker (Plan 1 of /goal audit).
//
// Visits every top-level route + every tab on the 4 tabbed pages, in
// both light and dark themes, against the LIVE dev stack (port 4000
// per `playwright.forensic.config.ts`). For each visit captures:
//
//   - nav timing + per-request network records (via gotoWithPerf)
//   - console errors with the route + theme tag (appended to
//     forensic.ndjson)
//   - full-page screenshot under screenshots/<route>-<theme>.png
//
// Output: e2e-logs/forensic-<ts>/{forensic.ndjson, screenshots/}
//
// The walker tolerates per-route failures — one broken route should
// not abort the rest of the sweep. Each failure becomes a finding
// entry rather than a stop-the-world test failure.
//
// Detail pages that need an id (epic/story/agent) are sampled by
// list-then-first-row; routes whose list is empty are recorded as
// `<list-only>` so the findings doc shows the gap.

const FORENSIC_ENABLED = process.env['FORENSIC'] === '1';

const TOP_LEVEL_ROUTES = [
    '/',
    '/scratch-pad',
    '/projects',
    '/epics',
    '/issues',
    '/queue',
    '/search',
    '/agents',
    '/agents/mcp-tools',
    '/agents/marketplace',
    '/notifications',
    '/reminders',
    '/guardrails',
    '/settings',
    '/settings/credentials',
    '/analytics',
] as const;

const TABS: Record<string, readonly string[]> = {
    '/notifications': ['external', 'in-app'],
    '/settings': ['profile', 'environment', 'secrets', 'models', 'notifications'],
};

// Detail pages: (list path → tabs to walk after entering first row)
const DETAIL_WALKS: Array<{ list: string; tabs?: readonly string[]; label: string }> = [
    { list: '/projects', tabs: ['overview', 'epics', 'issues', 'guardrails', 'setup', 'history'], label: 'project' },
    { list: '/agents', tabs: ['overview', 'prompt', 'handoffs', 'test', 'runs', 'memory'], label: 'agent' },
    { list: '/epics', label: 'epic' },
];

const THEMES: ThemeMode[] = ['light', 'dark'];

const RUN_TS = nowSlug();
const OUT_DIR = process.env['OUT_DIR'] ?? `e2e-logs/forensic-${RUN_TS}`;
const FINDINGS_LOG = join(OUT_DIR, 'forensic.ndjson');
const SCREENSHOT_DIR = join(OUT_DIR, 'screenshots');

interface ForensicRecord {
    captured_at: string;
    route: string;
    theme: ThemeMode;
    title: string;
    nav_load_ms: number;
    ttfb_ms: number;
    request_count: number;
    api_request_count: number;
    total_bytes: number;
    web_vitals_count: number;
    console_errors: string[];
    failed_requests: string[];
    screenshot_path: string;
    error?: string;
}

function nowSlug(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDirs(): void {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function appendFinding(record: ForensicRecord): void {
    ensureDirs();
    appendFileSync(FINDINGS_LOG, `${JSON.stringify(record)}\n`);
}

function screenshotName(route: string, theme: ThemeMode): string {
    const safe = route === '/' ? 'root' : route.replace(/^\//, '').replace(/[/?=&]+/g, '_');
    return `${safe}-${theme}.png`;
}

async function walk(page: Page, route: string, theme: ThemeMode): Promise<void> {
    ensureDirs();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() !== 'error') return;
        consoleErrors.push(msg.text());
    };
    const onRequestFailed = (req: { url(): string; failure(): { errorText: string } | null }) => {
        const fail = req.failure();
        failedRequests.push(`${req.url()} ${fail?.errorText ?? ''}`);
    };
    const onPageError = (err: Error) => {
        consoleErrors.push(`pageerror: ${err.message}`);
    };

    page.on('console', onConsole);
    page.on('requestfailed', onRequestFailed);
    page.on('pageerror', onPageError);

    let perf;
    let error: string | undefined;
    try {
        perf = await gotoWithPerf(page, route);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        page.off('console', onConsole);
        page.off('requestfailed', onRequestFailed);
        page.off('pageerror', onPageError);
    }

    const screenshotPath = join(SCREENSHOT_DIR, screenshotName(route, theme));
    try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
        // Screenshot can fail if the page navigated mid-capture; we
        // still want the rest of the record in the ndjson.
    }

    appendFinding({
        captured_at: new Date().toISOString(),
        route,
        theme,
        title: perf?.title ?? '',
        nav_load_ms: perf?.nav_timing.load_ms ?? -1,
        ttfb_ms: perf?.nav_timing.ttfb_ms ?? -1,
        request_count: perf?.request_count ?? 0,
        api_request_count: perf?.api_request_count ?? 0,
        total_bytes: perf?.total_bytes ?? 0,
        web_vitals_count: perf?.web_vitals.length ?? 0,
        console_errors: consoleErrors,
        failed_requests: failedRequests,
        screenshot_path: screenshotPath,
        ...(error ? { error } : {}),
    });
}

async function firstDetailHref(page: Page, list: string, label: string): Promise<string | null> {
    await page.goto(list);
    await page.waitForLoadState('domcontentloaded');
    // First try the anchor pattern (used by /agents which renders MUI Card-as-Link).
    const anchorSelector = `a[href^="${list}/"]:not([href$="/new"])`;
    const link = page.locator(anchorSelector).first();
    if ((await link.count()) > 0) {
        const href = await link.getAttribute('href');
        if (href && !href.includes('/new') && !href.endsWith(list)) return href;
    }
    // F-007 fix (2026-06-13): list views like /projects and /epics render
    // each row as a MUI Button with onClick + useNavigate (not <a href>).
    // Wait for any row button to appear, click the first one, then read the
    // URL the router landed on. Captures the same detail page that a real
    // user click would.
    try {
        await page.waitForSelector(`button[role="button"], [role="row"] button`, { timeout: 5000 });
    } catch {
        console.log(`[forensic] no clickable row appeared on ${list}`);
        return null;
    }
    const rowButton = page.locator(`[role="row"] button, table button, [data-row-button]`).first();
    if ((await rowButton.count()) === 0) {
        // Last-resort: try any cursor-pointer button in the main content.
        const fallback = page.locator(`main button[role="button"]`).first();
        if ((await fallback.count()) === 0) return null;
        await fallback.click();
    } else {
        await rowButton.click();
    }
    await page.waitForLoadState('domcontentloaded');
    const url = new URL(page.url());
    const path = url.pathname;
    if (path === list || path.endsWith(list)) {
        console.log(`[forensic] click on ${list} did not navigate (URL ${path})`);
        return null;
    }
    return path;
}

test.describe('forensic walkthrough', () => {
    test.skip(!FORENSIC_ENABLED, 'FORENSIC=1 not set; skipping forensic audit');

    test.beforeAll(() => {
        ensureDirs();
        console.log(`[forensic] writing findings to ${FINDINGS_LOG}`);
        console.log(`[forensic] writing screenshots to ${SCREENSHOT_DIR}`);
    });

    for (const theme of THEMES) {
        test.describe(`theme=${theme}`, () => {
            test.beforeEach(async ({ page }) => {
                await setThemeMode(page, theme);
            });

            for (const route of TOP_LEVEL_ROUTES) {
                test(`walk ${route}`, async ({ page }) => {
                    await walk(page, route, theme);
                });

                const tabs = TABS[route];
                if (tabs) {
                    for (const tab of tabs) {
                        test(`walk ${route}?tab=${tab}`, async ({ page }) => {
                            await walk(page, `${route}?tab=${tab}`, theme);
                        });
                    }
                }
            }

            for (const detail of DETAIL_WALKS) {
                test(`walk first ${detail.label} detail`, async ({ page }) => {
                    const href = await firstDetailHref(page, detail.list, detail.label);
                    if (!href) {
                        test.skip(true, `no ${detail.label} row found on ${detail.list}`);
                        return;
                    }
                    await walk(page, href, theme);
                    if (detail.tabs) {
                        for (const tab of detail.tabs) {
                            await walk(page, `${href}?tab=${tab}`, theme);
                        }
                    }
                });
            }
        });
    }

    test('summary: findings file exists with >=1 record', async () => {
        expect(existsSync(FINDINGS_LOG)).toBe(true);
    });
});
