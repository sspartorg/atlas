import { test, expect } from '@playwright/test';
import { gotoWithPerfCold, gotoWithPerfWarm } from '../helpers/perf-cold-warm.js';
import { gotoWithPerf } from '../helpers/perf.js';

// W7 chunk 1 — cold + warm TTI baseline for all 26+ routes.
//
// Cold variant: clears cookies + browser caches before navigation.
// Warm variant:  first visit to populate caches, then re-navigates.
//
// TTI proxy: nav_timing.load_ms (conservative upper bound — fires after
// all sub-resources + initial React render + mount-time API fan-out).
//
// Budget: p95 TTI < 200ms on hermetic e2e stack.  This spec does NOT
// assert the budget — it records the baseline so the p95 can be
// computed from the NDJSON log.  Budget assertions are introduced in
// the follow-on W7 perf-fix chunk once we know which routes breach it.
//
// Gated by PERF=1.  Invoke via `pnpm e2e:perf`.

const PERF_ENABLED = process.env['PERF'] === '1';

// Static routes: always navigable, no dynamic ID.
const STATIC_ROUTES = [
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

test.describe('cold/warm TTI baseline', () => {
    test.skip(!PERF_ENABLED, 'PERF=1 not set; skipping cold/warm baseline capture');
    // Cold + warm visits do double the navigation work; per-test bump to
    // 120s matches the baseline.spec.ts ceiling and accommodates slow
    // chart-heavy routes (/analytics, /agents/marketplace).
    test.setTimeout(120_000);

    // ------------------------------------------------------------------
    // Static routes — cold
    // ------------------------------------------------------------------
    test.describe('cold navigation', () => {
        for (const path of STATIC_ROUTES) {
            test(`cold ${path}`, async ({ page, context }) => {
                const record = await gotoWithPerfCold(page, context, path);
                expect(record.path).toBe(path);
                expect(record.variant).toBe('cold');
                // Record but don't assert — we're building the baseline.
                // The load_ms annotation in the NDJSON will be processed
                // externally to compute p95 per route.
                expect(record.perf.nav_timing.load_ms).toBeGreaterThanOrEqual(0);
            });
        }
    });

    // ------------------------------------------------------------------
    // Static routes — warm
    // ------------------------------------------------------------------
    test.describe('warm navigation', () => {
        for (const path of STATIC_ROUTES) {
            test(`warm ${path}`, async ({ page, context }) => {
                const record = await gotoWithPerfWarm(page, context, path);
                expect(record.path).toBe(path);
                expect(record.variant).toBe('warm');
                expect(record.perf.nav_timing.load_ms).toBeGreaterThanOrEqual(0);
            });
        }
    });

    // ------------------------------------------------------------------
    // Dynamic routes — cold (sampled from list pages)
    // ------------------------------------------------------------------
    test.describe('dynamic routes cold', () => {
        test('cold /projects/:id (first seeded project)', async ({ page, context }) => {
            // Warm-up the list to find the first project link.
            await gotoWithPerf(page, '/projects');
            const projectLink = page.locator('a[href^="/projects/"]').first();
            if ((await projectLink.count()) === 0) {
                test.skip(true, 'no seeded project');
                return;
            }
            const href = await projectLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /projects/:id/guardrails (first seeded project)', async ({ page, context }) => {
            await gotoWithPerf(page, '/projects');
            const projectLink = page.locator('a[href^="/projects/"]').first();
            if ((await projectLink.count()) === 0) {
                test.skip(true, 'no seeded project');
                return;
            }
            const href = await projectLink.getAttribute('href');
            if (!href) return;
            const projectId = href.replace('/projects/', '').split('/')[0];
            const record = await gotoWithPerfCold(page, context, `/projects/${projectId}/guardrails`);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /epics/:id (first seeded epic)', async ({ page, context }) => {
            await gotoWithPerf(page, '/epics');
            const epicLink = page.locator('a[href^="/epics/"]')
                .filter({ hasNot: page.locator('[href="/epics/new"]') })
                .first();
            if ((await epicLink.count()) === 0) {
                test.skip(true, 'no seeded epic');
                return;
            }
            const href = await epicLink.getAttribute('href');
            if (!href || href === '/epics/new') return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /issues/stories/:id (first seeded story)', async ({ page, context }) => {
            await gotoWithPerf(page, '/issues');
            const storyLink = page.locator('a[href^="/issues/stories/"]').first();
            if ((await storyLink.count()) === 0) {
                test.skip(true, 'no seeded story');
                return;
            }
            const href = await storyLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /issues/bugs/:id (first seeded bug)', async ({ page, context }) => {
            await gotoWithPerf(page, '/issues');
            const bugLink = page.locator('a[href^="/issues/bugs/"]').first();
            if ((await bugLink.count()) === 0) {
                test.skip(true, 'no seeded bug');
                return;
            }
            const href = await bugLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /agents/:id (first seeded agent)', async ({ page, context }) => {
            await gotoWithPerf(page, '/agents');
            const agentLink = page.locator('a[href^="/agents/"]')
                .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
                .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
                .first();
            if ((await agentLink.count()) === 0) {
                test.skip(true, 'no seeded agent');
                return;
            }
            const href = await agentLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /agents/marketplace/:id (first marketplace agent)', async ({ page, context }) => {
            await gotoWithPerf(page, '/agents/marketplace');
            const mktLink = page.locator('a[href^="/agents/marketplace/"]').first();
            if ((await mktLink.count()) === 0) {
                test.skip(true, 'no marketplace agents visible');
                return;
            }
            const href = await mktLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /analytics/project/:id (first analytics project)', async ({ page, context }) => {
            await gotoWithPerf(page, '/analytics');
            const projLink = page.locator('a[href^="/analytics/project/"]').first();
            if ((await projLink.count()) === 0) {
                test.skip(true, 'no analytics project links');
                return;
            }
            const href = await projLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('cold /analytics/epic/:id (first analytics epic)', async ({ page, context }) => {
            await gotoWithPerf(page, '/analytics');
            const epicLink = page.locator('a[href^="/analytics/epic/"]').first();
            if ((await epicLink.count()) === 0) {
                test.skip(true, 'no analytics epic links');
                return;
            }
            const href = await epicLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfCold(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });
    });

    // ------------------------------------------------------------------
    // Dynamic routes — warm (sampled from list pages)
    // ------------------------------------------------------------------
    test.describe('dynamic routes warm', () => {
        test('warm /projects/:id (first seeded project)', async ({ page, context }) => {
            await gotoWithPerf(page, '/projects');
            const projectLink = page.locator('a[href^="/projects/"]').first();
            if ((await projectLink.count()) === 0) {
                test.skip(true, 'no seeded project');
                return;
            }
            const href = await projectLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /projects/:id/guardrails (first seeded project)', async ({ page, context }) => {
            await gotoWithPerf(page, '/projects');
            const projectLink = page.locator('a[href^="/projects/"]').first();
            if ((await projectLink.count()) === 0) {
                test.skip(true, 'no seeded project');
                return;
            }
            const href = await projectLink.getAttribute('href');
            if (!href) return;
            const projectId = href.replace('/projects/', '').split('/')[0];
            const record = await gotoWithPerfWarm(page, context, `/projects/${projectId}/guardrails`);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /epics/:id (first seeded epic)', async ({ page, context }) => {
            await gotoWithPerf(page, '/epics');
            const epicLink = page.locator('a[href^="/epics/"]')
                .filter({ hasNot: page.locator('[href="/epics/new"]') })
                .first();
            if ((await epicLink.count()) === 0) {
                test.skip(true, 'no seeded epic');
                return;
            }
            const href = await epicLink.getAttribute('href');
            if (!href || href === '/epics/new') return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /issues/stories/:id (first seeded story)', async ({ page, context }) => {
            await gotoWithPerf(page, '/issues');
            const storyLink = page.locator('a[href^="/issues/stories/"]').first();
            if ((await storyLink.count()) === 0) {
                test.skip(true, 'no seeded story');
                return;
            }
            const href = await storyLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /issues/bugs/:id (first seeded bug)', async ({ page, context }) => {
            await gotoWithPerf(page, '/issues');
            const bugLink = page.locator('a[href^="/issues/bugs/"]').first();
            if ((await bugLink.count()) === 0) {
                test.skip(true, 'no seeded bug');
                return;
            }
            const href = await bugLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /agents/:id (first seeded agent)', async ({ page, context }) => {
            await gotoWithPerf(page, '/agents');
            const agentLink = page.locator('a[href^="/agents/"]')
                .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
                .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
                .first();
            if ((await agentLink.count()) === 0) {
                test.skip(true, 'no seeded agent');
                return;
            }
            const href = await agentLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /agents/marketplace/:id (first marketplace agent)', async ({ page, context }) => {
            await gotoWithPerf(page, '/agents/marketplace');
            const mktLink = page.locator('a[href^="/agents/marketplace/"]').first();
            if ((await mktLink.count()) === 0) {
                test.skip(true, 'no marketplace agents visible');
                return;
            }
            const href = await mktLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /analytics/project/:id (first analytics project)', async ({ page, context }) => {
            await gotoWithPerf(page, '/analytics');
            const projLink = page.locator('a[href^="/analytics/project/"]').first();
            if ((await projLink.count()) === 0) {
                test.skip(true, 'no analytics project links');
                return;
            }
            const href = await projLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });

        test('warm /analytics/epic/:id (first analytics epic)', async ({ page, context }) => {
            await gotoWithPerf(page, '/analytics');
            const epicLink = page.locator('a[href^="/analytics/epic/"]').first();
            if ((await epicLink.count()) === 0) {
                test.skip(true, 'no analytics epic links');
                return;
            }
            const href = await epicLink.getAttribute('href');
            if (!href) return;
            const record = await gotoWithPerfWarm(page, context, href);
            expect(record.tti_proxy_ms).toBeGreaterThanOrEqual(0);
        });
    });

    // The TTI < 200ms enforcement is intentionally NOT in this spec —
    // it is owned by the follow-on W7 chunk (perf-fix), which will read
    // the NDJSON output produced here, compute the p95 per route, and
    // tighten the bar only on routes that have legitimately landed under
    // the budget. Asserting in dev today would flake on Vite proxy
    // overhead (~50ms per call) and Windows networking jitter.
});
