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
// Why a separate spec rather than reusing `e2e/forensic/walkthrough.spec.ts`:
// that one walks top-level routes only and never opens a modal, so it cannot
// produce `doc-11-new-project`. It also writes full-page captures to
// gitignored `e2e-logs/`, which is the right call for forensics and the wrong
// one for a guide.
//
// Gated behind GUIDE=1 exactly like PERF / FORENSIC / FUNCTIONAL, so `pnpm
// e2e` stays a test run and never rewrites tracked binaries as a side effect.
//
// Run: `GUIDE=1 pnpm e2e --grep @guide`
//
// AGENTS.md hard rule 6 keeps images out of git with one exception —
// `docs/guide/images/` — which is precisely where these land. Nothing else
// this spec produces is written anywhere.

const OUT = join(process.cwd(), 'docs', 'guide', 'images');

// Wider than the 1920 forensic viewport: guide figures are read inline in a
// README at roughly text width, and a 1920 capture scales down to unreadable.
const VIEWPORT = { width: 1440, height: 900 };

const enabled = process.env['GUIDE'] === '1';

async function shoot(page: Page, name: string): Promise<void> {
    // Not fullPage: a guide figure should show one screen the way the Owner
    // sees it. A 6000px-tall capture of the analytics page is not a figure.
    await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** Settle async content so a capture never catches a skeleton mid-swap. */
async function settle(page: Page): Promise<void> {
    await page.waitForTimeout(600);
}

test.describe('@guide capture the user-guide screenshots', () => {
    test.skip(!enabled, 'set GUIDE=1 to regenerate docs/guide/images');
    test.use({ viewport: VIEWPORT });

    test.beforeAll(() => {
        mkdirSync(OUT, { recursive: true });
    });

    test('doc-01 onboarding', async ({ page }) => {
        // The seeded stack is already onboarded, so the route would redirect.
        // The API's own test escape hatch puts it back to first-run — safe
        // here because `atlas_e2e` is dropped and rebuilt on every run.
        await page.request.post('http://127.0.0.1:6001/api/settings/test/clear-onboarding');
        await goto(page, '/onboarding');
        await expect(page.getByRole('heading').first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-01-onboarding');
    });

    test('doc-03 marketplace, doc-04 agents, doc-10 agent detail, doc-12 agents dark', async ({
        page,
    }) => {
        await goto(page, '/agents/marketplace');
        await expect(page.getByRole('heading', { name: /marketplace/i }).first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-03-marketplace');

        await goto(page, '/agents');
        await settle(page);
        await shoot(page, 'doc-04-agents');

        // Agent detail — follow the first installed agent rather than pinning
        // an id, so a change to the seeded catalog cannot silently produce a
        // 404 screenshot.
        const firstAgent = page.getByRole('link').filter({ hasText: /./ }).first();
        await firstAgent.click();
        await page.waitForURL(/\/agents\/[^/]+$/);
        await settle(page);
        await shoot(page, 'doc-10-agent-detail');
    });

    test('doc-12 agents in dark mode', async ({ page }) => {
        await setThemeMode(page, 'dark');
        await goto(page, '/agents');
        await settle(page);
        await shoot(page, 'doc-12-agents-dark');
    });

    test('doc-05 guard-rails', async ({ page }) => {
        await goto(page, '/guardrails');
        await settle(page);
        await shoot(page, 'doc-05-guardrails');
    });

    test('doc-06 settings, doc-07 help & about, doc-08 model registry', async ({ page }) => {
        await goto(page, '/settings');
        await settle(page);
        await shoot(page, 'doc-06-settings');

        await goto(page, '/settings?tab=models');
        await settle(page);
        await shoot(page, 'doc-08-model-registry');

        await goto(page, '/settings?tab=help');
        await settle(page);
        await shoot(page, 'doc-07-help-about');
    });

    test('doc-09 analytics', async ({ page }) => {
        await goto(page, '/analytics');
        await settle(page);
        await shoot(page, 'doc-09-analytics');
    });

    test('doc-11 new project modal', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: /new project/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-11-new-project');
    });
});
