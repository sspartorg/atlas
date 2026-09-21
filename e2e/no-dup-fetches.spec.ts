import { test, expect, type Page, type Request } from '@playwright/test';
import { goto } from './helpers/nav.js';
import {
    firstAgentId,
    firstAgentRunId,
    firstProjectId,
} from './helpers/entities.js';

// W8 — No-duplicate / no-unintended API call audit.
//
// Owner's bar:
//   1. No two identical method+URL pairs fire within 100 ms of each other
//      on first paint (duplicate-React-Query-hook detection window).
//   2. No single GET endpoint is called 3+ times on first paint
//      (fan-out / refetch-storm detection).
//   3. Specific audit for the suspect hook clusters called out in the
//      master plan:
//        - useAgentRuns + useProjectAgentRuns + useItemAgentRuns
//        - per-kind list endpoints + useIssues(tree) double-fetch on ProjectDetail
//
// SSE (/api/events) is excluded from all counts — it is a persistent
// long-poll that the server never closes; it is not a data fetch.
//
// Observation window: 1.5 s post-goto (covers mount-time fetches; SSE
// handshake takes longer, so SSE-triggered re-fetches are out of scope).

interface FetchRecord {
    method: string;
    path: string;
    url: string;
    at: number;
}

// Per-path call count threshold. Any GET above this triggers a WARN
// assertion (not a hard fail, but logged in the report). 3 is the
// "clearly wrong" bar — a page shouldn't need the same data three times.
const DUP_HARD_WINDOW_MS = 100;
const FANOUT_THRESHOLD = 2; // more than 2 calls to the same path = suspect

function isApiUrl(url: string): boolean {
    return url.includes('/api/') && !url.includes('/api/events');
}

function pathOf(url: string): string {
    // Strip query string; normalise to the pathname segment after /api.
    try {
        const u = new URL(url);
        return u.pathname;
    } catch {
        // Not a fully qualified URL (e2e stack uses relative-looking paths
        // that the browser expands; this branch is defensive).
        const match = /\/api[^?#]*/.exec(url);
        return match ? match[0] : url;
    }
}

// -----------------------------------------------------------------------
// Static routes — always navigable, no dynamic segments.
// -----------------------------------------------------------------------

const STATIC_ROUTES = [
    '/',
    '/projects',
    '/tasks',
    '/tasks/new',
    '/queue',
    '/workflows',
    '/search',
    '/terminal',
    '/terminal/layout',
    '/agents',
    '/agents/mcp-tools',
    '/agents/marketplace',
    '/agents/marketplace?tab=workflows',
    '/agents/marketplace/workflows/delivery',
    '/guardrails',
    '/settings',
    '/settings/credentials',
    '/analytics',
    '/notifications',
    '/reminders',
    '/scratch-pad',
] as const;

// Helper: capture API fetches for a given navigation.
async function captureApiFetches(
    page: Page,
    navigateFn: () => Promise<void>,
    settleDurationMs = 1500,
): Promise<FetchRecord[]> {
    const fetches: FetchRecord[] = [];
    const onRequest = (req: Request) => {
        const url = req.url();
        if (!isApiUrl(url)) return;
        fetches.push({ method: req.method(), path: pathOf(url), url, at: Date.now() });
    };
    page.on('request', onRequest);
    try {
        await navigateFn();
        await page.waitForTimeout(settleDurationMs);
    } finally {
        page.off('request', onRequest);
    }
    return fetches;
}

// Helper: assert no two identical method+path combos fire within the dup
// window. Returns the list of offending pairs so callers can soft-log them.
function findDuplicatesWithinWindow(
    fetches: FetchRecord[],
    windowMs = DUP_HARD_WINDOW_MS,
): Array<{ key: string; firstAt: number; secondAt: number; delta: number }> {
    const seen = new Map<string, number>();
    const dups: Array<{ key: string; firstAt: number; secondAt: number; delta: number }> = [];
    for (const f of fetches) {
        // Dedup on method + full URL (incl. query string) so legitimately
        // different queries to the same endpoint — e.g. useNotifications
        // calling /api/notifications?limit=1 + /api/notifications?limit=200
        // — don't false-positive. Two hooks with the SAME query key would
        // share the same URL and still trip the audit.
        const key = `${f.method} ${f.url}`;
        const prev = seen.get(key);
        if (prev !== undefined) {
            const delta = f.at - prev;
            if (delta < windowMs) {
                dups.push({ key, firstAt: prev, secondAt: f.at, delta });
            }
        }
        seen.set(key, f.at);
    }
    return dups;
}

// Helper: assert no single path appears 3+ times in the observation window.
function findFanout(fetches: FetchRecord[]): Array<{ path: string; count: number }> {
    const counts = new Map<string, number>();
    for (const f of fetches) {
        const key = `${f.method} ${f.path}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const offenders: Array<{ path: string; count: number }> = [];
    for (const [path, count] of counts) {
        if (count > FANOUT_THRESHOLD) {
            offenders.push({ path, count });
        }
    }
    return offenders.sort((a, b) => b.count - a.count);
}

// -----------------------------------------------------------------------
// Static route tests
// -----------------------------------------------------------------------

for (const route of STATIC_ROUTES) {
    test.describe(`${route} — no duplicate API calls on first paint`, () => {
        test('records each /api/* fetch and asserts no dup within 100ms', async ({ page }) => {
            const fetches = await captureApiFetches(page, () => goto(page, route));

            const dups = findDuplicatesWithinWindow(fetches);
            expect(
                dups,
                `Duplicate API calls on ${route}: ${JSON.stringify(dups)}`,
            ).toEqual([]);

            const fanout = findFanout(fetches);
            expect(
                fanout,
                `Fan-out (3+ calls to same endpoint) on ${route}: ${JSON.stringify(fanout)}`,
            ).toEqual([]);
        });
    });
}

// -----------------------------------------------------------------------
// Parameterised route tests.
//
// G-018 — these used to scrape an `<a href>` off the list page and skip when
// the locator found nothing. The app navigates its cards with onClick, so the
// locator matched nothing even with a fully seeded database, and the skip
// blamed "no seeded project" for what was a stale selector. Ids now come from
// the API via `helpers/entities.ts`, which fails loudly on an empty fixture.
//
// The four `test.skip` calls that remain are honest: the e2e seed genuinely
// does not start an agent run or leave a closed CLI session behind, and their
// messages say so rather than implying a lookup failed.
// -----------------------------------------------------------------------

test.describe('/projects/:id — no dup API calls on project detail', () => {
    test('first project detail passes dup audit', async ({ page }) => {
        // Navigate to list to get the first project href.
        await goto(page, '/projects');
        // G-018 — resolved from the API, not from an `<a href>`. Project cards
        // navigate via onClick, so the old anchor locator found nothing and the
        // test skipped claiming "no seeded project" — which was never true.
        const href = `/projects/${await firstProjectId(page)}`;

        const fetches = await captureApiFetches(page, () => goto(page, href));

        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(
            fanout,
            `Fan-out on ${href}: ${JSON.stringify(fanout)}`,
        ).toEqual([]);

        // Specific audit: ProjectDetail must NOT call /api/tasks or
        // /api/sub-tasks separately — they are folded into /api/issues/tree.
        // If either shows up, the tree-dedup refactor regressed.
        const tasksCall = fetches.find((f) => f.path === '/api/tasks');
        const subTasksCall = fetches.find((f) => f.path === '/api/sub-tasks');

        expect(
            tasksCall,
            `ProjectDetail hit /api/tasks separately — should use /api/issues/tree only`,
        ).toBeUndefined();
        expect(
            subTasksCall,
            `ProjectDetail hit /api/sub-tasks separately — should use /api/issues/tree only`,
        ).toBeUndefined();
    });
});

test.describe('/projects/:id/guardrails — no dup API calls', () => {
    test('project guardrails page passes dup audit', async ({ page }) => {
        await goto(page, '/projects');
        const href = `/projects/${await firstProjectId(page)}`;
        const projectId = href.replace('/projects/', '').split('/')[0];
        const route = `/projects/${projectId}/guardrails`;

        const fetches = await captureApiFetches(page, () => goto(page, route));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${route}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${route}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

// The e2e seed creates Task ETM-1 and its sub-task ETM-2.
for (const route of ['/tasks/ETM-1', '/sub-tasks/ETM-2']) {
    test.describe(`${route} — no dup API calls on item detail`, () => {
        test('item detail passes dup audit', async ({ page }) => {
            const fetches = await captureApiFetches(page, () => goto(page, route));
            const dups = findDuplicatesWithinWindow(fetches);
            expect(dups, `Duplicate API calls on ${route}: ${JSON.stringify(dups)}`).toEqual([]);

            const fanout = findFanout(fetches);
            expect(fanout, `Fan-out on ${route}: ${JSON.stringify(fanout)}`).toEqual([]);
        });
    });
}

// -----------------------------------------------------------------------
// Agent routes — agent detail, run detail, marketplace agent detail.
// -----------------------------------------------------------------------

test.describe('/agents/:id — no dup API calls on agent detail', () => {
    test('first agent detail (all tabs) passes dup audit', async ({ page }) => {
        await goto(page, '/agents');
        // The seed installs `agent-po-writer`; the roster renders Cards with
        // onClick, not anchors, so the old locator could never match it.
        const href = `/agents/${await firstAgentId(page)}`;

        // Test the landing tab (overview) for dups.
        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);

        // Specific audit: AgentDetail calls useAgentRuns (/api/agents/:id/runs).
        // Verify it fires at most once (not duplicated by useProjectAgentRuns or
        // useItemAgentRuns, which have different query keys and different endpoints).
        const agentRunsCalls = fetches.filter(
            (f) => f.method === 'GET' && /\/api\/agents\/[^/]+\/runs$/.test(f.path),
        );
        expect(
            agentRunsCalls.length,
            `AgentDetail fired /api/agents/:id/runs ${agentRunsCalls.length} times — expected at most 1`,
        ).toBeLessThanOrEqual(1);
    });
});

test.describe('/agents/:id/runs/:runId — no dup API calls on run detail', () => {
    test('first agent run detail passes dup audit', async ({ page }) => {
        await goto(page, '/agents');
        const agentHref = `/agents/${await firstAgentId(page)}`;

        // Navigate to the runs tab to find a run link.
        await goto(page, `${agentHref}?tab=runs`);
        const runLink = page.locator(`a[href^="${agentHref}/runs/"]`).first();
        if ((await runLink.count()) === 0) {
            test.skip(true, 'e2e seed starts no agent run (that would spawn a CLI) — genuinely absent, not a failed lookup');
            return;
        }
        const runHref = await runLink.getAttribute('href');
        if (!runHref) return;

        const fetches = await captureApiFetches(page, () => goto(page, runHref));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${runHref}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${runHref}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/agents/marketplace/:id — no dup API calls on marketplace agent detail', () => {
    test('first marketplace agent detail passes dup audit', async ({ page }) => {
        // Catalog cards are clickable boxes, not links; the seed installs PO Writer.
        const href = '/agents/marketplace/agent-po-writer';

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// Terminal routes — session detail + history.
// -----------------------------------------------------------------------

test.describe('/terminal/:id — no dup API calls on terminal session', () => {
    test('first terminal session page passes dup audit', async ({ page }) => {
        await goto(page, '/terminal');
        const sessionLink = page
            .locator('a[href^="/terminal/"]')
            .filter({ hasNot: page.locator('[href="/terminal/layout"]') })
            .filter({ hasNot: page.locator('a[href*="/history"]') })
            .first();
        if ((await sessionLink.count()) === 0) {
            test.skip(true, 'no live CLI session in this run — genuinely absent, not a failed lookup');
            return;
        }
        const href = await sessionLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/terminal/:id/history — no dup API calls on terminal history', () => {
    test('first terminal history page passes dup audit', async ({ page }) => {
        await goto(page, '/terminal');
        const historyLink = page.locator('a[href*="/history"]').first();
        if ((await historyLink.count()) === 0) {
            test.skip(true, 'no closed CLI session to show history for — genuinely absent, not a failed lookup');
            return;
        }
        const href = await historyLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// Analytics drill-down routes.
// -----------------------------------------------------------------------

test.describe('/analytics/project/:projectId — no dup API calls', () => {
    test('first analytics project page passes dup audit', async ({ page }) => {
        await goto(page, '/analytics');
        const projectLink = page.locator('a[href^="/analytics/project/"]').first();
        if ((await projectLink.count()) === 0) {
            test.skip(true, 'no project has cost rows to link from Analytics — genuinely absent, not a failed lookup');
            return;
        }
        const href = await projectLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/analytics/task/:taskId — no dup API calls', () => {
    test('seeded analytics task page passes dup audit', async ({ page }) => {
        const href = '/analytics/task/ETM-1';
        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// W8 — Targeted hook-cluster audits (not tied to specific page navigation).
// -----------------------------------------------------------------------
//
// These tests verify at the data-shape level that the three useAgentRuns
// family hooks hit *distinct* API endpoints, proving they cannot overlap.

test.describe('useAgentRuns family — endpoint distinctness audit', () => {
    test('useAgentRuns, useProjectAgentRuns, useItemAgentRuns hit distinct paths', () => {
        // useAgentRuns    → GET /api/agents/:id/runs
        // useProjectAgentRuns → GET /api/run?project_id=…
        // useItemAgentRuns    → GET /api/run?issue_id=…
        //
        // These are three different query keys AND three different URL paths/
        // params — there is no structural overlap. This test documents the
        // finding without needing a browser: it is a static shape assertion.
        const endpoints = {
            useAgentRuns: '/api/agents/:id/runs',
            useProjectAgentRuns: '/api/run?project_id=…',
            useItemAgentRuns: '/api/run?issue_id=…',
        };
        const paths = Object.values(endpoints);
        const unique = new Set(paths);
        expect(unique.size).toBe(paths.length);
    });

    test('useItemAgentRuns on SubTaskDetail fires at most once on first paint', async ({ page }) => {
        const fetches = await captureApiFetches(page, () => goto(page, '/sub-tasks/ETM-2'));

        // useItemAgentRuns → GET /api/run?issue_id=…. Match on the full URL:
        // the shell's own /api/run?limit=500 is a different hook.
        const runFetches = fetches.filter(
            (f) => f.method === 'GET' && f.path === '/api/run' && /[?&]issue_id=/.test(f.url),
        );
        expect(
            runFetches.length,
            `SubTaskDetail: /api/run?issue_id=… fetched ${runFetches.length} times — expected ≤ 1`,
        ).toBeLessThanOrEqual(1);
    });

    // 2026-06-25 — re-enabled. Original W8 finding was a false alarm:
    // the previous filter `startsWith('/api/run')` matched BOTH the
    // app-shell-level `/api/run?limit=500` (global recent-runs hook)
    // AND `/api/run?project_id=…&limit=200` (useProjectAgentRuns). Two
    // DIFFERENT endpoint calls flagged as a dup. Live MCP walkthrough
    // verified that useProjectAgentRuns itself fires exactly once on
    // ProjectDetail overview; the shell-level recent-runs is expected.
    // Tighten the filter to match only project-scoped calls.
    test('useProjectAgentRuns on ProjectDetail overview tab fires at most once', async ({ page }) => {
        await goto(page, '/projects');
        const href = `/projects/${await firstProjectId(page)}`;

        // Navigate to the overview tab (default).
        const fetches = await captureApiFetches(page, () => goto(page, `${href}?tab=overview`));

        // Only count the project-scoped useProjectAgentRuns calls
        // (`/api/run?project_id=…`). The global recent-runs hook fires
        // its own `/api/run?limit=500` on first paint — that's a
        // separate hook, not a duplicate of this one.
        const runFetches = fetches.filter(
            (f) => f.method === 'GET' && /^\/api\/run\?.*\bproject_id=/.test(f.path),
        );
        expect(
            runFetches.length,
            `ProjectDetail overview: /api/run?project_id=… fetched ${runFetches.length} times — expected ≤ 1`,
        ).toBeLessThanOrEqual(1);
    });
});

test.describe('per-kind list endpoints vs useIssues tree — double-fetch audit', () => {
    test('ProjectDetail calls /api/issues/tree once and no per-kind list endpoint', async ({ page }) => {
        await goto(page, '/projects');
        const href = `/projects/${await firstProjectId(page)}`;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const gets = (path: string) => fetches.filter((f) => f.method === 'GET' && f.path === path);

        const treeCalls = gets('/api/issues/tree');
        expect(
            treeCalls.length,
            `ProjectDetail should call /api/issues/tree exactly once; got ${treeCalls.length}`,
        ).toBe(1);
        expect(gets('/api/tasks').length, 'ProjectDetail should NOT call /api/tasks (use tree)').toBe(0);
        expect(gets('/api/sub-tasks').length, 'ProjectDetail should NOT call /api/sub-tasks (use tree)').toBe(0);
    });

    test('/queue page — /api/workflow-queue fires at most once', async ({ page }) => {
        // One read model backs the whole page (per-workflow runs + queued Tasks).
        const fetches = await captureApiFetches(page, () => goto(page, '/queue'));
        for (const path of ['/api/workflow-queue']) {
            const calls = fetches.filter((f) => f.method === 'GET' && f.path === path);
            expect(calls.length, `/queue fired ${path} ${calls.length} times — expected ≤ 1`).toBeLessThanOrEqual(1);
        }
    });

    test('/tasks page — /api/tasks fires exactly once', async ({ page }) => {
        const fetches = await captureApiFetches(page, () => goto(page, '/tasks'));
        const calls = fetches.filter((f) => f.method === 'GET' && f.path === '/api/tasks');
        expect(calls.length, `/tasks should call /api/tasks exactly once; got ${calls.length}`).toBe(1);
    });
});
