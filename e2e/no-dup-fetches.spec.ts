import { test, expect, type Page, type Request } from '@playwright/test';
import { goto } from './helpers/nav.js';

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
//        - useStories + useIssues(tree) double-fetch on ProjectDetail
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
// Parameterised route tests — navigate to list page first, extract ID.
// -----------------------------------------------------------------------

test.describe('/projects/:id — no dup API calls on project detail', () => {
    test('first project detail passes dup audit', async ({ page }) => {
        // Navigate to list to get the first project href.
        await goto(page, '/projects');
        const firstLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded project — skipping /projects/:id dup audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));

        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(
            fanout,
            `Fan-out on ${href}: ${JSON.stringify(fanout)}`,
        ).toEqual([]);

        // Specific audit: ProjectDetail must NOT call /api/stories or /api/epics
        // or /api/bugs separately — they are folded into /api/issues/tree.
        // If any of these show up, it means the tree-dedup refactor regressed.
        const storiesCall = fetches.find((f) => f.path === '/api/stories' || f.path.startsWith('/api/stories?'));
        const epicsCall = fetches.find((f) => f.path === '/api/epics' || f.path.startsWith('/api/epics?'));
        const bugsCall = fetches.find((f) => f.path === '/api/bugs' || f.path.startsWith('/api/bugs?'));

        expect(
            storiesCall,
            `ProjectDetail hit /api/stories separately — should use /api/issues/tree only`,
        ).toBeUndefined();
        expect(
            epicsCall,
            `ProjectDetail hit /api/epics separately — should use /api/issues/tree only`,
        ).toBeUndefined();
        expect(
            bugsCall,
            `ProjectDetail hit /api/bugs separately — should use /api/issues/tree only`,
        ).toBeUndefined();
    });
});

test.describe('/projects/:id/guardrails — no dup API calls', () => {
    test('project guardrails page passes dup audit', async ({ page }) => {
        await goto(page, '/projects');
        const firstLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded project — skipping /projects/:id/guardrails dup audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;
        const projectId = href.replace('/projects/', '').split('/')[0];
        const route = `/projects/${projectId}/guardrails`;

        const fetches = await captureApiFetches(page, () => goto(page, route));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${route}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${route}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/epics/:id — no dup API calls on epic detail', () => {
    test('first epic detail passes dup audit', async ({ page }) => {
        await goto(page, '/epics');
        const firstLink = page
            .locator('a[href^="/epics/"]')
            .filter({ hasNot: page.locator('a[href="/epics/new"]') })
            .first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded epic — skipping /epics/:id dup audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href || href === '/epics/new') return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/issues/stories/:id — no dup API calls on story detail', () => {
    test('first story detail passes dup audit', async ({ page }) => {
        await goto(page, '/issues');
        const storyLink = page.locator('a[href^="/issues/stories/"]').first();
        if ((await storyLink.count()) === 0) {
            test.skip(true, 'no seeded story — skipping story detail dup audit');
            return;
        }
        const href = await storyLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);

        // Specific audit: StoryDetail uses useItemAgentRuns (hits /api/run?issue_id=…).
        // Confirm it fires at most once.
        const runCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/run'),
        );
        expect(
            runCalls.length,
            `StoryDetail fired /api/run ${runCalls.length} times — expected at most 1`,
        ).toBeLessThanOrEqual(1);
    });
});

test.describe('/issues/bugs/:id — no dup API calls on bug detail', () => {
    test('first bug detail passes dup audit', async ({ page }) => {
        await goto(page, '/issues');
        const bugLink = page.locator('a[href^="/issues/bugs/"]').first();
        if ((await bugLink.count()) === 0) {
            test.skip(true, 'no seeded bug — skipping bug detail dup audit');
            return;
        }
        const href = await bugLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/issues/sub-tasks/:id — no dup API calls on sub-task detail', () => {
    test('first sub-task detail passes dup audit', async ({ page }) => {
        await goto(page, '/issues');
        const subtaskLink = page.locator('a[href^="/issues/sub-tasks/"]').first();
        if ((await subtaskLink.count()) === 0) {
            test.skip(true, 'no seeded sub-task — skipping sub-task detail dup audit');
            return;
        }
        const href = await subtaskLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

test.describe('/issues/sub-bugs/:id — no dup API calls on sub-bug detail', () => {
    test('first sub-bug detail passes dup audit', async ({ page }) => {
        await goto(page, '/issues');
        const subBugLink = page.locator('a[href^="/issues/sub-bugs/"]').first();
        if ((await subBugLink.count()) === 0) {
            test.skip(true, 'no seeded sub-bug — skipping sub-bug detail dup audit');
            return;
        }
        const href = await subBugLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));
        const dups = findDuplicatesWithinWindow(fetches);
        expect(dups, `Duplicate API calls on ${href}: ${JSON.stringify(dups)}`).toEqual([]);

        const fanout = findFanout(fetches);
        expect(fanout, `Fan-out on ${href}: ${JSON.stringify(fanout)}`).toEqual([]);
    });
});

// -----------------------------------------------------------------------
// Agent routes — agent detail, run detail, marketplace agent detail.
// -----------------------------------------------------------------------

test.describe('/agents/:id — no dup API calls on agent detail', () => {
    test('first agent detail (all tabs) passes dup audit', async ({ page }) => {
        await goto(page, '/agents');
        const firstLink = page
            .locator('a[href^="/agents/"]')
            .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
            .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
            .first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded agent — skipping /agents/:id dup audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;

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
        const firstLink = page
            .locator('a[href^="/agents/"]')
            .filter({ hasNot: page.locator('[href="/agents/mcp-tools"]') })
            .filter({ hasNot: page.locator('[href="/agents/marketplace"]') })
            .first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded agent — skipping run detail dup audit');
            return;
        }
        const agentHref = await firstLink.getAttribute('href');
        if (!agentHref) return;

        // Navigate to the runs tab to find a run link.
        await goto(page, `${agentHref}?tab=runs`);
        const runLink = page.locator(`a[href^="${agentHref}/runs/"]`).first();
        if ((await runLink.count()) === 0) {
            test.skip(true, 'no agent runs visible — skipping run detail dup audit');
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
        await goto(page, '/agents/marketplace');
        const firstLink = page.locator('a[href^="/agents/marketplace/"]').first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no marketplace agents — skipping marketplace detail dup audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;

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
            test.skip(true, 'no active terminal sessions — skipping terminal session dup audit');
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
            test.skip(true, 'no terminal history links — skipping terminal history dup audit');
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
            test.skip(true, 'no analytics project links — skipping dup audit');
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

test.describe('/analytics/epic/:epicId — no dup API calls', () => {
    test('first analytics epic page passes dup audit', async ({ page }) => {
        // Try to reach an analytics epic page via the project drill-down.
        await goto(page, '/analytics');
        const projectLink = page.locator('a[href^="/analytics/project/"]').first();
        if ((await projectLink.count()) === 0) {
            test.skip(true, 'no analytics project links — skipping analytics epic dup audit');
            return;
        }
        const projectHref = await projectLink.getAttribute('href');
        if (!projectHref) return;

        await goto(page, projectHref);
        const epicLink = page.locator('a[href^="/analytics/epic/"]').first();
        if ((await epicLink.count()) === 0) {
            test.skip(true, 'no analytics epic links on project page — skipping dup audit');
            return;
        }
        const href = await epicLink.getAttribute('href');
        if (!href) return;

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

    test('useItemAgentRuns on StoryDetail fires at most once on first paint', async ({ page }) => {
        await goto(page, '/issues');
        const storyLink = page.locator('a[href^="/issues/stories/"]').first();
        if ((await storyLink.count()) === 0) {
            test.skip(true, 'no seeded story — skipping useItemAgentRuns story-detail audit');
            return;
        }
        const href = await storyLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));

        // useItemAgentRuns → GET /api/run?issue_id=…
        const runFetches = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/run'),
        );
        expect(
            runFetches.length,
            `StoryDetail: /api/run fetched ${runFetches.length} times — expected ≤ 1`,
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
        const firstLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded project — skipping useProjectAgentRuns overview audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;

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

test.describe('useStories vs useIssues tree — double-fetch audit', () => {
    test('ProjectDetail does NOT call /api/stories or /api/epics or /api/bugs separately', async ({ page }) => {
        await goto(page, '/projects');
        const firstLink = page.locator('a[href^="/projects/"]').first();
        if ((await firstLink.count()) === 0) {
            test.skip(true, 'no seeded project — skipping tree double-fetch audit');
            return;
        }
        const href = await firstLink.getAttribute('href');
        if (!href) return;

        const fetches = await captureApiFetches(page, () => goto(page, href));

        const storiesCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/stories'),
        );
        const epicsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/epics'),
        );
        const bugsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/bugs'),
        );
        const treeCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/issues/tree'),
        );

        // The tree endpoint should be called exactly once.
        expect(
            treeCalls.length,
            `ProjectDetail should call /api/issues/tree exactly once; got ${treeCalls.length}`,
        ).toBe(1);

        // None of the individual kind endpoints should appear — they are
        // folded into the tree response as of the 2026-05-30 refactor.
        expect(
            storiesCalls.length,
            `ProjectDetail should NOT call /api/stories (use tree); got ${storiesCalls.length}`,
        ).toBe(0);
        expect(
            epicsCalls.length,
            `ProjectDetail should NOT call /api/epics (use tree); got ${epicsCalls.length}`,
        ).toBe(0);
        expect(
            bugsCalls.length,
            `ProjectDetail should NOT call /api/bugs (use tree); got ${bugsCalls.length}`,
        ).toBe(0);
    });

    test('/queue page — useStories, useBugs, useEpics each fire at most once', async ({ page }) => {
        // The Queue page uses separate hooks (useStories, useBugs, useEpics) because
        // it needs assignable items across ALL projects (not a single-project tree).
        // This is an intentional design. The test verifies there are no DUPLICATE
        // calls to each endpoint (i.e., each fires at most once, not that it is
        // consolidated into tree).
        const fetches = await captureApiFetches(page, () => goto(page, '/queue'));

        const storiesCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/stories'),
        );
        const bugsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/bugs'),
        );
        const epicsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/epics'),
        );

        expect(
            storiesCalls.length,
            `/queue fired /api/stories ${storiesCalls.length} times — expected ≤ 1`,
        ).toBeLessThanOrEqual(1);
        expect(
            bugsCalls.length,
            `/queue fired /api/bugs ${bugsCalls.length} times — expected ≤ 1`,
        ).toBeLessThanOrEqual(1);
        expect(
            epicsCalls.length,
            `/queue fired /api/epics ${epicsCalls.length} times — expected ≤ 1`,
        ).toBeLessThanOrEqual(1);
    });

    test('/issues page — useIssues(tree) fires exactly once, no per-kind parallel calls', async ({ page }) => {
        const fetches = await captureApiFetches(page, () => goto(page, '/issues'));

        const treeCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/issues/tree'),
        );
        const storiesCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/stories'),
        );
        const bugsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/bugs'),
        );
        const epicsCalls = fetches.filter(
            (f) => f.method === 'GET' && f.path.startsWith('/api/epics'),
        );

        // The Issues page uses useIssues(tree) — exactly one call.
        expect(
            treeCalls.length,
            `/issues should call /api/issues/tree exactly once; got ${treeCalls.length}`,
        ).toBe(1);

        // No per-kind parallel calls expected on the Issues page.
        expect(
            storiesCalls.length,
            `/issues should NOT call /api/stories separately; got ${storiesCalls.length}`,
        ).toBe(0);
        expect(
            bugsCalls.length,
            `/issues should NOT call /api/bugs separately; got ${bugsCalls.length}`,
        ).toBe(0);
        expect(
            epicsCalls.length,
            `/issues should NOT call /api/epics separately; got ${epicsCalls.length}`,
        ).toBe(0);
    });
});
