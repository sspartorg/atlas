import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// T7 — Visual snapshot baseline across 3 viewports × 2 themes.
//
// One screenshot per (route × theme × project). Linux Chromium baselines
// only — Playwright stores snapshots with a platform suffix under
// `__snapshots__/snapshots.spec.ts/` so Windows / Darwin dev runs would
// diff against the wrong file. Gated on `CI=true`.
//
// Projects (declared in playwright.config.ts):
//   chromium      — 1920×1080 desktop
//   mobile-chrome —  390× 844 mobile (grep: /@mobile/)
//   ipad-chrome   —  834×1194 tablet (grep: /@ipad/)
//
// Tests are tagged `@mobile @ipad` in their title so they run across all
// three projects. The chromium project has no grep, so it picks up every
// test in this file naturally.
//
// First-time seed: a Linux CI run with `--update-snapshots` produces the
// baseline images and commits them; subsequent runs assert no visual
// regression beyond the maxDiffPixelRatio / threshold in
// playwright.config.ts.
//
// Detail-route IDs: ETM-1 is the seeded epic in `e2e-terminal-project`
// (see `e2e/fixtures/run-seed.ts`). No story / sub-task / bug / sub-bug
// is seeded, so detail snapshots that need those skip rather than create
// transient data (created-then-deleted items would invalidate the
// baseline on every run as IDs shift).
//
// Modal-opened scenarios capture each modal in its open state without
// committing data — the user-visible state is the goal.

const TOP_LEVEL_ROUTES = [
    '/',
    '/projects',
    '/epics',
    '/issues',
    '/agents',
    '/agents/marketplace',
    '/agents/mcp-tools',
    '/queue',
    '/search',
    '/notifications',
    '/reminders',
    '/settings',
    '/settings/credentials',
    '/guardrails',
    '/analytics',
    '/terminal',
    '/terminal/layout',
    '/scratch-pad',
];

const DETAIL_ROUTES = [
    '/projects/e2e-terminal-project',
    '/projects/e2e-terminal-project?tab=epics',
    '/projects/e2e-terminal-project?tab=guardrails',
    '/epics/ETM-1',
    '/analytics/project/e2e-terminal-project',
    '/analytics/epic/ETM-1',
];

const THEMES = ['light', 'dark'] as const;

// Skip locally — Windows/macOS would produce a baseline image that doesn't
// match the CI Linux baseline.
test.skip(!process.env['CI'], 'visual snapshots are Linux-CI-only');

function safeName(route: string): string {
    return route.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

for (const theme of THEMES) {
    test.describe(`visual baseline — ${theme} theme`, () => {
        for (const route of [...TOP_LEVEL_ROUTES, ...DETAIL_ROUTES]) {
            // `@mobile @ipad` in the test title makes mobile-chrome and
            // ipad-chrome projects pick this up via their grep filters.
            // The chromium project has no grep so it runs every test.
            test(`${route} renders the canonical layout @mobile @ipad`, async ({ page }) => {
                await page.addInitScript((t) => {
                    localStorage.setItem('atlas.theme', t);
                }, theme);

                await goto(page, route);

                await page.waitForLoadState('networkidle').catch(() => {
                    // networkidle can stall on SSE streams; fall back.
                });
                // Larger viewports (1920×1080) render more chunks lazily;
                // give the rehydrate cycle slightly more time to settle.
                await page.waitForTimeout(1000);

                await expect(page.locator('main, [role="main"], body').first()).toBeVisible();

                await expect(page).toHaveScreenshot(
                    `${theme}--${safeName(route)}.png`,
                    { fullPage: true },
                );
            });
        }
    });
}

// Modal-opened scenarios — capture each modal in its open state. We open
// from a known trigger, wait for the dialog, then snapshot. We do NOT
// submit (would mutate data and invalidate the baseline).
test.describe('visual baseline — modal scenarios @mobile @ipad', () => {
    test('NewProjectModal opened from /projects', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: /new project/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot('modal--new-project.png', { fullPage: true });
    });

    test('CredentialModal opened from /settings/credentials', async ({ page }) => {
        await goto(page, '/settings/credentials');
        await page.getByRole('button', { name: /add credential/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot('modal--credential.png', { fullPage: true });
    });

    test('New reminder modal opened from /reminders', async ({ page }) => {
        await goto(page, '/reminders');
        await page.getByRole('button', { name: /new reminder/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot('modal--new-reminder.png', { fullPage: true });
    });
});
