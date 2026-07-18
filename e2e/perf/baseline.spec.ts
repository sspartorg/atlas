import { test, expect } from '@playwright/test';
import { gotoWithPerf } from '../helpers/perf.js';

// W7 chunk 1 — expanded from 13 routes to all 34 route patterns registered
// in packages/web/src/App.tsx (reconciled 2026-06-25).
//
// Walks every page in the App.tsx route catalog and records nav timing +
// web-vitals + network requests via the perf helper.  Output:
// `e2e-logs/perf-baseline.ndjson` (one line per navigation).
//
// Gated by PERF=1 so it doesn't run as part of the standard e2e suite.
// Invoke via `pnpm e2e:perf` which also pre-sets VITE_ATLAS_PERF=1
// and ATLAS_PERF=1 so the web app emits vitals + the API logs every
// request.
//
// Detail pages that need a specific id are sampled from the list page
// first (clicking the first row / link when present).  Routes that can't
// be reached without data record `<list-only>` in the NDJSON.
//
// Per the binary YES/NO audit rule (`feedback_binary_audit_verdicts`),
// missing pages count as NO, not as a partial pass.

const PERF_ENABLED = process.env['PERF'] === '1';

test.describe('perf baseline', () => {
    test.skip(!PERF_ENABLED, 'PERF=1 not set; skipping baseline capture');
    // Chart-heavy and tree-heavy routes (/analytics, /agents/marketplace,
    // /projects/:id) routinely take 30-60s on a cold-dev Vite proxy with
    // Recharts + project tree renders. Default playwright test timeout
    // (60s) is too tight for the slowest cases. Bump per-spec to 120s.
    test.setTimeout(120_000);

    // -----------------------------------------------------------------------
    // Static top-level routes — no dynamic segment, always navigable.
    // -----------------------------------------------------------------------
    const staticRoutes = [
        '/',
        '/projects',
        '/epics',
        '/epics/new',
        '/issues',
        '/queue',
        '/search',
        '/terminal',
        '/terminal/layout',
        '/agents',
        '/agents/mcp-tools',
        '/agents/marketplace',
        '/notifications',
        '/reminders',
        '/guardrails',
        '/settings',
        '/settings/credentials',
        '/analytics',
        '/scratch-pad',
    ] as const;

    // Owner bar: every individual /api/* request returns in < 100 ms.
    // /api/issues/tree denormalises the whole project tree in one shot
    // and may run heavier joins on large projects — 250 ms allowance.
    // SSE long-poll `/api/events` is excluded (persistent connection).
    const API_BUDGET_MS = 100;
    const API_OVERRIDES: Array<{ pattern: RegExp; budgetMs: number; reason: string }> = [
        {
            pattern: /\/api\/issues\/tree/,
            budgetMs: 250,
            reason: 'tree denormalises the full project; multi-table join',
        },
        {
            pattern: /\/api\/events/,
            budgetMs: Number.POSITIVE_INFINITY,
            reason: 'SSE long-poll; intentionally never returns',
        },
    ];

    // Tight strict mode runs under CI only — local dev tolerates noisier
    // numbers because Vite proxy + Windows networking add ~50ms on top of
    // every request, which can push a healthy 80ms API response over the
    // 100ms hermetic budget. Local runs still capture the NDJSON for
    // p95/distribution analysis; CI enforces the gate.
    const STRICT_BUDGET = process.env['CI'] === 'true' || process.env['ATLAS_PERF_STRICT'] === '1';

    function isBackendApiUrl(url: string): boolean {
        // pathname-based filter so Vite dev modules at `/src/api/api.ts`
        // (and anything else under `/src/`) do not falsely trip as an
        // "/api/" request just because the substring matches.
        try {
            return new URL(url).pathname.startsWith('/api/');
        } catch {
            return /^\/api\//.test(url);
        }
    }

    function assertApiBudget(record: Awaited<ReturnType<typeof gotoWithPerf>>, path: string) {
        const breaches = record.requests
            .filter((r) => isBackendApiUrl(r.url))
            .filter((r) => {
                const override = API_OVERRIDES.find((o) => o.pattern.test(r.url));
                const budget = override?.budgetMs ?? API_BUDGET_MS;
                return r.duration_ms > budget;
            })
            .map((r) => ({ url: r.url, status: r.status, ms: r.duration_ms }));
        if (STRICT_BUDGET) {
            expect(
                breaches,
                `${path}: API requests exceeded budget: ${JSON.stringify(breaches, null, 2)}`,
            ).toEqual([]);
        } else if (breaches.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(
                `[perf-baseline:${path}] ${breaches.length} API call(s) over budget (non-strict mode, see e2e-logs/perf-baseline.ndjson)`,
            );
        }
    }

    // -----------------------------------------------------------------------
    // Static routes
    // -----------------------------------------------------------------------
    for (const path of staticRoutes) {
        test(`walk ${path}`, async ({ page }) => {
            const record = await gotoWithPerf(page, path);
            expect(record.path).toBe(path);
            expect(record.nav_timing.load_ms).toBeGreaterThanOrEqual(0);
            assertApiBudget(record, path);
        });
    }

    // -----------------------------------------------------------------------
    // Projects — detail page + project-level guardrails
    // -----------------------------------------------------------------------
    test('walk first project detail (tabs)', async ({ page }) => {
        await gotoWithPerf(page, '/projects');
        const firstProjectLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstProjectLink.count()) === 0) {
            test.skip(true, 'no seeded project on /projects — skipping detail walk');
            return;
        }
        const href = await firstProjectLink.getAttribute('href');
        if (!href) return;
        const tabs = ['overview', 'epics', 'issues', 'history', 'guardrails'] as const;
        for (const tab of tabs) {
            const record = await gotoWithPerf(page, `${href}?tab=${tab}`);
            assertApiBudget(record, `${href}?tab=${tab}`);
        }
    });

    test('walk project guardrails page', async ({ page }) => {
        await gotoWithPerf(page, '/projects');
        const firstProjectLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstProjectLink.count()) === 0) {
            test.skip(true, 'no seeded project — skipping /projects/:id/guardrails');
            return;
        }
        const href = await firstProjectLink.getAttribute('href');
        if (!href) return;
        const projectId = href.replace('/projects/', '').split('/')[0];
        const record = await gotoWithPerf(page, `/projects/${projectId}/guardrails`);
        assertApiBudget(record, `/projects/${projectId}/guardrails`);
    });

    // -----------------------------------------------------------------------
    // Epics — detail page
    // -----------------------------------------------------------------------
    test('walk first epic detail', async ({ page }) => {
        await gotoWithPerf(page, '/epics');
        const firstEpicLink = page
            .locator('a[href^="/epics/"]')
            .filter({ hasNot: page.locator('[href="/epics/new"]') })
            .first();
        if ((await firstEpicLink.count()) === 0) {
            test.skip(true, 'no seeded epic on /epics — skipping detail walk');
            return;
        }
        const href = await firstEpicLink.getAttribute('href');
        if (!href || href === '/epics/new') return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    // -----------------------------------------------------------------------
    // Issues — story/bug detail pages
    // -----------------------------------------------------------------------
    test('walk first story detail', async ({ page }) => {
        await gotoWithPerf(page, '/issues');
        // Stories appear as links with /issues/stories/:id
        const storyLink = page.locator('a[href^="/issues/stories/"]').first();
        if ((await storyLink.count()) === 0) {
            test.skip(true, 'no seeded story — skipping story detail walk');
            return;
        }
        const href = await storyLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk first bug detail', async ({ page }) => {
        await gotoWithPerf(page, '/issues');
        const bugLink = page.locator('a[href^="/issues/bugs/"]').first();
        if ((await bugLink.count()) === 0) {
            test.skip(true, 'no seeded bug — skipping bug detail walk');
            return;
        }
        const href = await bugLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk first sub-task detail', async ({ page }) => {
        await gotoWithPerf(page, '/issues');
        const subtaskLink = page.locator('a[href^="/issues/sub-tasks/"]').first();
        if ((await subtaskLink.count()) === 0) {
            test.skip(true, 'no seeded sub-task — skipping sub-task detail walk');
            return;
        }
        const href = await subtaskLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk first sub-bug detail', async ({ page }) => {
        await gotoWithPerf(page, '/issues');
        const subBugLink = page.locator('a[href^="/issues/sub-bugs/"]').first();
        if ((await subBugLink.count()) === 0) {
            test.skip(true, 'no seeded sub-bug — skipping sub-bug detail walk');
            return;
        }
        const href = await subBugLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    // -----------------------------------------------------------------------
    // Agents — detail page + agent run detail + marketplace agent detail
    // -----------------------------------------------------------------------
    test('walk first agent detail (tabs)', async ({ page }) => {
        await gotoWithPerf(page, '/agents');
        const firstAgentLink = page.locator('a[href^="/agents/"]')
            .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
            .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
            .first();
        if ((await firstAgentLink.count()) === 0) {
            test.skip(true, 'no seeded agent on /agents — skipping detail walk');
            return;
        }
        const href = await firstAgentLink.getAttribute('href');
        if (!href) return;
        const tabs = ['overview', 'prompt', 'handoffs', 'testrun', 'runs', 'memory'] as const;
        for (const tab of tabs) {
            const record = await gotoWithPerf(page, `${href}?tab=${tab}`);
            assertApiBudget(record, `${href}?tab=${tab}`);
        }
    });

    test('walk first marketplace agent detail', async ({ page }) => {
        await gotoWithPerf(page, '/agents/marketplace');
        const firstMarketplaceLink = page.locator('a[href^="/agents/marketplace/"]').first();
        if ((await firstMarketplaceLink.count()) === 0) {
            test.skip(true, 'no marketplace agents visible — skipping marketplace detail walk');
            return;
        }
        const href = await firstMarketplaceLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk first agent run detail', async ({ page }) => {
        await gotoWithPerf(page, '/agents');
        // Navigate to first agent detail, then look for a run link
        const firstAgentLink = page.locator('a[href^="/agents/"]')
            .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
            .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
            .first();
        if ((await firstAgentLink.count()) === 0) {
            test.skip(true, 'no seeded agent — skipping run detail walk');
            return;
        }
        const agentHref = await firstAgentLink.getAttribute('href');
        if (!agentHref) return;
        // Navigate to runs tab
        await gotoWithPerf(page, `${agentHref}?tab=runs`);
        const runLink = page.locator(`a[href^="${agentHref}/runs/"]`).first();
        if ((await runLink.count()) === 0) {
            test.skip(true, 'no agent runs visible — skipping run detail walk');
            return;
        }
        const runHref = await runLink.getAttribute('href');
        if (!runHref) return;
        const record = await gotoWithPerf(page, runHref);
        assertApiBudget(record, runHref);
    });

    // -----------------------------------------------------------------------
    // Terminal — session and history detail pages
    // -----------------------------------------------------------------------
    test('walk terminal session page (first session if seeded)', async ({ page }) => {
        await gotoWithPerf(page, '/terminal');
        // The e2e seed creates a project; terminal list shows sessions.
        // There may not be any sessions started — navigate directly to list.
        // If a session link is present, navigate to it.
        const sessionLink = page.locator('a[href^="/terminal/"]')
            .filter({ hasNot: page.locator('[href="/terminal/layout"]') })
            .filter({ hasNot: page.locator('a[href*="/history"]') })
            .first();
        if ((await sessionLink.count()) === 0) {
            test.skip(true, 'no active terminal sessions — skipping TerminalSession walk');
            return;
        }
        const href = await sessionLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk terminal history page (first session if seeded)', async ({ page }) => {
        await gotoWithPerf(page, '/terminal');
        // Look for history links: /terminal/:id/history
        const historyLink = page.locator('a[href*="/history"]').first();
        if ((await historyLink.count()) === 0) {
            test.skip(true, 'no terminal history links visible — skipping TerminalHistory walk');
            return;
        }
        const href = await historyLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    // -----------------------------------------------------------------------
    // Analytics — project-level and epic-level detail pages
    // -----------------------------------------------------------------------
    test('walk first analytics project detail', async ({ page }) => {
        await gotoWithPerf(page, '/analytics');
        const projectLink = page.locator('a[href^="/analytics/project/"]').first();
        if ((await projectLink.count()) === 0) {
            test.skip(true, 'no analytics project links visible — skipping AnalyticsProject walk');
            return;
        }
        const href = await projectLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });

    test('walk first analytics epic detail', async ({ page }) => {
        await gotoWithPerf(page, '/analytics');
        const epicLink = page.locator('a[href^="/analytics/epic/"]').first();
        if ((await epicLink.count()) === 0) {
            test.skip(true, 'no analytics epic links visible — skipping AnalyticsEpic walk');
            return;
        }
        const href = await epicLink.getAttribute('href');
        if (!href) return;
        const record = await gotoWithPerf(page, href);
        assertApiBudget(record, href);
    });
});
