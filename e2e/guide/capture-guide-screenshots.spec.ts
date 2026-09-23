import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { goto } from '../helpers/nav.js';
import { setThemeMode } from '../helpers/theme.js';

// G-005 — the generator `docs/guide/README.md` never had.
//
// Twelve of its fifteen screenshots were captured by hand before the
// 2026-09-20 factory reset and showed a retired project under its old issue
// key. The previous campaign kept them rather than ship a guide with no
// pictures, and left its own checkbox unticked because a full recapture was
// still outstanding. Recapturing by hand would have left the next refresh
// exactly as expensive, so this exists instead.
//
// Why not `e2e/forensic/walkthrough.spec.ts`: it walks top-level routes only
// and never opens a modal, so it cannot produce `doc-11-new-project`, and it
// writes full-page captures to gitignored `e2e-logs/` — right for forensics,
// wrong for a guide figure.
//
// Gated behind GUIDE=1 like PERF / FORENSIC / FUNCTIONAL, so `pnpm e2e` stays
// a test run and never rewrites tracked binaries as a side effect.
//
// Run: `GUIDE=1 pnpm e2e --grep @guide`
//
// AGENTS.md hard rule 6 keeps images out of git with one exception —
// `docs/guide/images/` — which is exactly where these land.
//
// ORDER IS LOAD-BEARING. `doc-01` clears onboarding to reach the first-run
// screen, and `RouteGuard` then redirects EVERY route to `/onboarding` until
// the workspace is set up again. The first version of this file captured
// onboarding first and silently wrote the welcome screen into
// `doc-06-settings.png`, `doc-09-analytics.png` and four others — six
// screenshots of the wrong page that all looked plausible in a file listing.
// Onboarding is captured last, and `assertNotOnboarding` now fails any capture
// that lands on the redirect anyway — belt and braces, because the failure mode
// is a plausible-looking wrong image rather than an error.

const OUT = join(process.cwd(), 'docs', 'guide', 'images');

// Wider than the 1920 forensic viewport: guide figures are read inline in a
// README at roughly text width, and a 1920 capture scales to unreadable.
const VIEWPORT = { width: 1440, height: 900 };

const enabled = process.env['GUIDE'] === '1';

/** Seeded by `e2e/fixtures/run-seed.ts`. */
const PROJECT_ID = 'e2e-terminal-project';
const API = 'http://127.0.0.1:6001';

async function shoot(page: Page, name: string): Promise<void> {
    // Not fullPage: a guide figure shows one screen the way the Owner sees it.
    await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** Settle async content so a capture never catches a skeleton mid-swap. */
async function settle(page: Page): Promise<void> {
    await page.waitForTimeout(800);
}

/** Guard against the redirect that produced six wrong images on the first run. */
async function assertNotOnboarding(page: Page, name: string): Promise<void> {
    expect(page.url(), `${name} captured the onboarding redirect, not its page`).not.toContain(
        '/onboarding',
    );
}

async function capture(page: Page, path: string, name: string): Promise<void> {
    await goto(page, path);
    await assertNotOnboarding(page, name);
    await settle(page);
    await shoot(page, name);
}

test.describe('@guide capture the user-guide screenshots', () => {
    test.skip(!enabled, 'set GUIDE=1 to regenerate docs/guide/images');
    // NOT serial: one capture failing must not abort the other seven. Order
    // still holds because the Playwright config runs a single worker, and the
    // onboarding capture is last in the file.
    test.use({ viewport: VIEWPORT });

    test.beforeAll(() => {
        mkdirSync(OUT, { recursive: true });
    });

    // FIRST, deliberately. This is the only capture that mutates the roster:
    // creating the delivery workflow installs the ten agents its graph
    // references. Captured last, it left doc-04 showing a one-agent roster and
    // doc-12 showing ten — two pictures of the same page that disagree.
    test('doc-14 workflow builder', async ({ page }) => {
        // The seed ships no workflow, so build the one the guide names. This
        // also installs the agents the template references, which is why the
        // capture asserts a node is on the canvas rather than trusting a 201.
        const res = await page.request.post(`${API}/api/workflows/from-template`, {
            data: { template_id: 'delivery', project_id: PROJECT_ID },
        });
        expect(res.status(), await res.text()).toBe(201);
        const { id } = (await res.json()) as { id: string };

        await goto(page, `/workflows/${id}`);
        await assertNotOnboarding(page, 'doc-14-workflow-builder');
        await expect(page.getByText('Workflow settings')).toBeVisible();
        // React Flow mounts the graph asynchronously; without this the canvas
        // photographs empty and the image looks like a broken builder.
        await expect(page.getByText('PO Writer').first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-14-workflow-builder');
    });

    test('doc-03 marketplace and doc-04 agents', async ({ page }) => {
        await capture(page, '/agents/marketplace', 'doc-03-marketplace');
        await capture(page, '/agents', 'doc-04-agents');
    });

    test('doc-10 agent detail', async ({ page }) => {
        // Ask the API which agents the seed installed rather than clicking a
        // card: the roster renders MUI Cards with onClick handlers, not
        // anchors, so there is no href to follow. Pinning an id in the spec
        // would instead risk a 404 screenshot the next time the catalog moves.
        const res = await page.request.get('http://127.0.0.1:6001/api/agents');
        const agents = (await res.json()) as Array<{ id: string }>;
        expect(agents.length, 'the seed installed no agents to screenshot').toBeGreaterThan(0);
        await capture(page, `/agents/${agents[0]!.id}`, 'doc-10-agent-detail');
    });

    test('doc-05 guard-rails', async ({ page }) => {
        await capture(page, '/guardrails', 'doc-05-guardrails');
    });

    test('doc-06 settings, doc-08 model registry, doc-07 help & about', async ({ page }) => {
        await capture(page, '/settings', 'doc-06-settings');
        await capture(page, '/settings?tab=models', 'doc-08-model-registry');
        await capture(page, '/settings?tab=help', 'doc-07-help-about');
    });

    test('doc-09 analytics', async ({ page }) => {
        await capture(page, '/analytics', 'doc-09-analytics');
    });

    test('doc-11 new project modal', async ({ page }) => {
        await goto(page, '/projects');
        await assertNotOnboarding(page, 'doc-11-new-project');
        await page.getByRole('button', { name: /new project/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-11-new-project');
    });

    // doc-15 was the one hand-captured image left, taken on the live dev stack
    // against a Task in review. The sweep that renamed that rail's button from
    // "Start now" to "Restart" on an in-review item turned it into a picture
    // that contradicts the running app. Captured here instead: the seeded
    // ETM-1 is `in_progress` with no workflow run, so the rail shows no run
    // controls at all and the image cannot drift with their labels again.
    test('doc-15 task detail', async ({ page }) => {
        await capture(page, '/tasks/ETM-1', 'doc-15-task-detail');
    });

    // doc-13 was hand-captured on the live dev stack, carrying a real project
    // name into a public repo. Placed before the dark-mode capture so it comes
    // out light like the rest of the set.
    test('doc-13 project repos', async ({ page }) => {
        await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
        await assertNotOnboarding(page, 'doc-13-project-repos');
        // Assert the Repos tab actually rendered. A bare capture here would
        // happily photograph the Overview tab and look entirely plausible.
        await expect(page.getByRole('button', { name: /add repo/i }).first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-13-project-repos');
    });

    test('doc-12 agents in dark mode', async ({ page }) => {
        await setThemeMode(page, 'dark');
        await goto(page, '/agents');
        await assertNotOnboarding(page, 'doc-12-agents-dark');
        await settle(page);
        await shoot(page, 'doc-12-agents-dark');
    });

    // LAST, and it must stay last — see the header. Clearing onboarding makes
    // every other route redirect here.
    test('doc-01 onboarding', async ({ page }) => {
        await page.request.post('http://127.0.0.1:6001/api/settings/test/clear-onboarding');
        await goto(page, '/onboarding');
        // The welcome copy, not a heading role — the step title is rendered as
        // styled Typography rather than an <h*>.
        await expect(page.getByText(/welcome to atlas/i).first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-01-onboarding');
    });
});
