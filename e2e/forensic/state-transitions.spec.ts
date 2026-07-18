import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setThemeMode, type ThemeMode } from '../helpers/theme.js';

// 2026-06-11 — Per-interaction state-transition walker. The
// functional-walkthrough spec enumerates every interactive element
// at rest; this spec exercises the meaningful click-through paths
// and asserts the resulting state transition lands.
//
// Scope: NON-DESTRUCTIVE only. We click affordances that
// open / switch / toggle — never affordances that submit / delete /
// create. State coverage is:
//
//   1. Theme toggle (Settings → Profile tab): click Light → data-theme=light,
//      click Dark → data-theme=dark, persistence via localStorage.
//   2. Tab navigation (Settings, AgentDetail-like): click each TabKey,
//      assert the URL ?tab=<key> and the active tab's panel renders.
//   3. Modal open + dismiss (where a non-destructive trigger exists).
//
// Gated by STATE_TRANSITIONS=1 so it doesn't run as part of the
// default e2e suite. Output: e2e-logs/state-<ts>/findings.ndjson +
// summary.md.

const ENABLED = process.env['STATE_TRANSITIONS'] === '1';

interface TransitionRecord {
    captured_at: string;
    page: string;
    interaction: string;
    expected: string;
    actual: string;
    passed: boolean;
    error?: string;
}

function nowSlug(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const RUN_TS = process.env['STATE_TS'] ?? nowSlug();
const OUT_DIR = process.env['OUT_DIR'] ?? `e2e-logs/state-${RUN_TS}`;
const FINDINGS = join(OUT_DIR, 'findings.ndjson');

function ensureOut(): void {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
}

function record(r: TransitionRecord): void {
    ensureOut();
    appendFileSync(FINDINGS, `${JSON.stringify(r)}\n`);
}

test.describe('state transitions — non-destructive', () => {
    test.skip(!ENABLED, 'STATE_TRANSITIONS=1 not set; skipping');

    test.beforeAll(() => {
        ensureOut();
        writeFileSync(FINDINGS, '');
    });

    // 1. Theme toggle persistence — uses the existing pattern from
    // theme-toggle.spec.ts but records the result so we capture it
    // in the same ndjson as the rest of the transitions.
    test('theme toggle: Light → data-theme=light; Dark → data-theme=dark', async ({ page }) => {
        await page.goto('/settings?tab=profile');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);

        const darkBtn = page.getByRole('radio', { name: /Dark/i });
        const lightBtn = page.getByRole('radio', { name: /Light/i });

        await darkBtn.click();
        const themeAfterDark = await page
            .locator('html')
            .getAttribute('data-theme');
        record({
            captured_at: new Date().toISOString(),
            page: '/settings?tab=profile',
            interaction: 'click Dark theme chip',
            expected: 'data-theme=dark',
            actual: `data-theme=${themeAfterDark}`,
            passed: themeAfterDark === 'dark',
        });
        expect(themeAfterDark).toBe('dark');

        await lightBtn.click();
        const themeAfterLight = await page
            .locator('html')
            .getAttribute('data-theme');
        record({
            captured_at: new Date().toISOString(),
            page: '/settings?tab=profile',
            interaction: 'click Light theme chip',
            expected: 'data-theme=light',
            actual: `data-theme=${themeAfterLight}`,
            passed: themeAfterLight === 'light',
        });
        expect(themeAfterLight).toBe('light');
    });

    // 2. Settings tabs — assert each TabKey click updates URL.
    test('settings tabs: each tab updates URL ?tab=<key>', async ({ page }) => {
        const tabs = ['profile', 'environment', 'secrets', 'models', 'notifications'] as const;
        await page.goto('/settings');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);

        for (const tab of tabs) {
            // Tabs may render as <button role="tab"> with the text label —
            // best-effort fuzzy match on the tab name (capitalised).
            // Settings labels: profile→Profile, environment→Environment,
            // secrets→Shared Secrets, models→Model Registry, notifications→Notifications.
            const SETTINGS_LABELS: Record<string, RegExp> = {
                profile: /^Profile$/i,
                environment: /^Environment$/i,
                secrets: /Shared Secrets/i,
                models: /Model Registry/i,
                notifications: /^Notifications$/i,
            };
            const tabEl = page.getByRole('tab', { name: SETTINGS_LABELS[tab]! });
            const exists = (await tabEl.count()) > 0;
            if (!exists) {
                record({
                    captured_at: new Date().toISOString(),
                    page: '/settings',
                    interaction: `click tab=${tab}`,
                    expected: 'tab element found',
                    actual: 'tab element NOT FOUND',
                    passed: false,
                });
                continue;
            }
            await tabEl.first().click();
            // useTabParam syncs URL via useEffect AFTER state update;
            // give it a generous window. Profile is the default tab —
            // clicking it intentionally does NOT push ?tab=profile.
            await page.waitForTimeout(500);
            const url = page.url();
            const isDefault = tab === 'profile';
            const urlMatch = isDefault
                ? !url.includes('?tab=') || url.includes('tab=profile')
                : url.includes(`tab=${tab}`);
            record({
                captured_at: new Date().toISOString(),
                page: '/settings',
                interaction: `click tab=${tab}`,
                expected: isDefault ? 'URL unchanged (default tab)' : `URL contains tab=${tab}`,
                actual: url,
                passed: urlMatch,
            });
        }
    });

    // 3. Notifications tabs — same pattern, different page. Diagnostic mode.
    test('notifications tabs: each tab click is recorded', async ({ page }) => {
        const tabs = ['external', 'in-app'] as const;
        await page.goto('/notifications');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);

        for (const tab of tabs) {
            // 'in-app' renders as 'In-app' / 'In app' depending on label style;
            // 'external' renders as 'Notification Log'.
            const labelRe =
                tab === 'in-app'
                    ? /^In/i
                    : tab === 'external'
                      ? /Notification Log/i
                      : new RegExp(`^${tab}`, 'i');
            const tabEl = page.getByRole('tab', { name: labelRe });
            const exists = (await tabEl.count()) > 0;
            if (!exists) {
                record({
                    captured_at: new Date().toISOString(),
                    page: '/notifications',
                    interaction: `click tab=${tab}`,
                    expected: 'tab element found',
                    actual: 'tab element NOT FOUND',
                    passed: false,
                });
                continue;
            }
            await tabEl.first().click();
            await page.waitForTimeout(500);
            const url = page.url();
            const isDefault = tab === 'external'; // 'external' is the notifications-page default
            const urlMatch = isDefault
                ? !url.includes('?tab=') || url.includes('tab=external')
                : url.includes(`tab=${tab}`);
            record({
                captured_at: new Date().toISOString(),
                page: '/notifications',
                interaction: `click tab=${tab}`,
                expected: isDefault ? 'URL unchanged (default tab)' : `URL contains tab=${tab}`,
                actual: url,
                passed: urlMatch,
            });
        }
    });

    // 4. Sidebar link → route change. Atlas's Sidenav uses
    // `<Box onClick>` (not `<a href>`), so we locate by visible text
    // within the sidebar `<aside>` and click.
    test('sidebar nav: clicking Agents row navigates to /agents', async ({ page }) => {
        await page.goto('/settings');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        // Atlas's sidebar is the <aside> on the left. There are TWO
        // "Agents" text nodes — the group header (no onClick) and the
        // row (clickable Box). The row appears AFTER the header in
        // DOM order, so `.nth(1)` picks the navigable one.
        const agentsRow = page.locator('aside').getByText('Agents', { exact: true }).nth(1);
        const exists = (await agentsRow.count()) > 0;
        if (!exists) {
            record({
                captured_at: new Date().toISOString(),
                page: '/settings → /agents',
                interaction: 'find sidebar Agents row',
                expected: 'sidebar row visible',
                actual: 'row not found in <aside>',
                passed: false,
            });
            return;
        }
        await agentsRow.click();
        await page.waitForURL('**/agents', { timeout: 5000 }).catch(() => undefined);
        const url = page.url();
        const ok = url.endsWith('/agents') || url.includes('/agents?');
        record({
            captured_at: new Date().toISOString(),
            page: '/settings → /agents',
            interaction: 'click sidebar Agents row',
            expected: 'URL ends with /agents',
            actual: url,
            passed: ok,
        });
    });

    // 5. Project detail tabs — 6 tabs, click each, record URL update.
    // Navigates to /projects, picks first project link, then exercises
    // overview/epics/issues/guardrails/setup/history.
    test('project detail tabs: click each, record URL update', async ({ page }) => {
        await page.goto('/projects');
        // Wait long enough for the React Query + list-render to finish; the
        // first project link doesn't appear until the data loads.
        await page.waitForSelector('a[href^="/projects/"]', { timeout: 10000 }).catch(() => undefined);
        const firstProjectLink = page
            .locator('a[href^="/projects/"]')
            .filter({ hasNotText: 'New Project' })
            .first();
        if ((await firstProjectLink.count()) === 0) {
            record({
                captured_at: new Date().toISOString(),
                page: '/projects',
                interaction: 'find first project link',
                expected: 'project row link visible',
                actual: 'no project links found',
                passed: false,
            });
            return;
        }
        const href = await firstProjectLink.getAttribute('href');
        if (!href) return;
        const tabs = ['overview', 'epics', 'issues', 'guardrails', 'setup', 'history'] as const;
        // Navigate ONCE to the detail page; the tab list renders after
        // useEpics + useStories + useBugs fan-out. Wait for the
        // tablist before clicking individual tabs.
        await page.goto(href);
        await page.waitForSelector('[role="tab"]', { timeout: 10000 }).catch(() => undefined);
        // ProjectDetail Tabs render a Material-Symbols icon as a
        // <Box component="span"> whose textContent ("dashboard",
        // "flag", etc.) is included in the role=tab accessible name.
        // So the actual name is "dashboard Overview", "flag Epics  3",
        // etc. We match by substring rather than anchoring to start.
        const PROJECT_LABELS: Record<string, RegExp> = {
            overview: /Overview/i,
            epics: /Epics/i,
            issues: /Issues/i,
            guardrails: /Guard-rails|Guardrails/i,
            setup: /Setup/i,
            history: /History/i,
        };
        for (const tab of tabs) {
            const tabEl = page.getByRole('tab', { name: PROJECT_LABELS[tab]! });
            const exists = (await tabEl.count()) > 0;
            if (!exists) {
                record({
                    captured_at: new Date().toISOString(),
                    page: href,
                    interaction: `find project-detail tab=${tab}`,
                    expected: 'tab role element',
                    actual: 'tab element NOT FOUND',
                    passed: false,
                });
                continue;
            }
            await tabEl.first().click();
            await page.waitForTimeout(500);
            const url = page.url();
            const urlMatch =
                url.includes(`tab=${tab}`) ||
                (tab === 'overview' && !url.includes('?tab=')); // overview is default
            record({
                captured_at: new Date().toISOString(),
                page: href,
                interaction: `click project-detail tab=${tab}`,
                expected: `URL reflects tab=${tab}`,
                actual: url,
                passed: urlMatch,
            });
        }
    });

    // 6. Agent detail tabs — 6 tabs, click each.
    // Agent cards are `<AgentCard onClick={navigate(...)}>`, NOT
    // `<a href>`. We navigate directly to a known agent id instead
    // of trying to click a card.
    test('agent detail tabs: click each, record URL update', async ({ page }) => {
        // Use a known seeded agent id — agent-architect is always
        // active per the marketplace catalog seed.
        const href = '/agents/agent-architect';
        await page.goto(href);
        // The agent-detail page renders a Tabs strip; wait for it.
        await page.waitForSelector('[role="tab"]', { timeout: 10000 }).catch(() => undefined);
        const probeRow = page.locator('[role="tab"]').first();
        if ((await probeRow.count()) === 0) {
            record({
                captured_at: new Date().toISOString(),
                page: href,
                interaction: 'find agent-detail tablist',
                expected: 'tablist rendered',
                actual: 'no [role="tab"] found',
                passed: false,
            });
            return;
        }
        const tabs = ['overview', 'prompt', 'handoffs', 'test', 'runs', 'memory'] as const;
        // AgentDetail Tabs also render Material-Symbols icons; the
        // role=tab name includes the icon text. Match by substring.
        const AGENT_LABELS: Record<string, RegExp> = {
            overview: /Overview/i,
            prompt: /Prompt/i,
            handoffs: /Handoffs/i,
            test: /Test run|Test/i,
            runs: /Runs/i,
            memory: /Memory/i,
        };
        for (const tab of tabs) {
            const tabEl = page.getByRole('tab', { name: AGENT_LABELS[tab]! });
            const exists = (await tabEl.count()) > 0;
            if (!exists) {
                record({
                    captured_at: new Date().toISOString(),
                    page: href,
                    interaction: `find agent-detail tab=${tab}`,
                    expected: 'tab role element',
                    actual: 'tab element NOT FOUND',
                    passed: false,
                });
                continue;
            }
            await tabEl.first().click();
            await page.waitForTimeout(500);
            const url = page.url();
            const isDefault = tab === 'overview';
            const urlMatch = isDefault
                ? !url.includes('?tab=') || url.includes('tab=overview')
                : url.includes(`tab=${tab}`);
            record({
                captured_at: new Date().toISOString(),
                page: href,
                interaction: `click agent-detail tab=${tab}`,
                expected: isDefault ? 'URL unchanged (default tab)' : `URL contains tab=${tab}`,
                actual: url,
                passed: urlMatch,
            });
        }
    });

    // 7. Modal open + dismiss — non-destructive triggers across several
    // pages. For each, click the trigger, assert a dialog appears,
    // then dismiss via the Cancel / Close affordance. NEVER submit.
    test('modal: New Project on /projects opens + cancels', async ({ page }) => {
        await page.goto('/projects');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        const trigger = page.getByRole('button', { name: /New Project/i }).first();
        const exists = (await trigger.count()) > 0;
        if (!exists) {
            record({
                captured_at: new Date().toISOString(),
                page: '/projects',
                interaction: 'find New Project trigger',
                expected: 'button visible',
                actual: 'not found by role=button name=/New Project/',
                passed: false,
            });
            return;
        }
        await trigger.click();
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
        const opened = (await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/projects',
            interaction: 'click New Project → modal opens',
            expected: 'dialog visible',
            actual: opened ? 'dialog open' : 'dialog NOT visible',
            passed: opened,
        });
        if (!opened) return;
        // Dismiss via Cancel button if present, else Escape.
        const cancel = page.getByRole('button', { name: /Cancel/i }).first();
        if ((await cancel.count()) > 0) {
            await cancel.click();
        } else {
            await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(300);
        const closed = !(await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/projects',
            interaction: 'click Cancel → modal closes',
            expected: 'dialog hidden',
            actual: closed ? 'dialog closed' : 'dialog still visible',
            passed: closed,
        });
    });

    test('modal: Add Agent on /agents opens + cancels', async ({ page }) => {
        await page.goto('/agents');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        const trigger = page.getByRole('button', { name: /Add Agent/i }).first();
        const exists = (await trigger.count()) > 0;
        if (!exists) {
            record({
                captured_at: new Date().toISOString(),
                page: '/agents',
                interaction: 'find Add Agent trigger',
                expected: 'button visible',
                actual: 'not found',
                passed: false,
            });
            return;
        }
        await trigger.click();
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
        const opened = (await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/agents',
            interaction: 'click Add Agent → modal opens',
            expected: 'dialog visible',
            actual: opened ? 'dialog open' : 'dialog NOT visible',
            passed: opened,
        });
        if (!opened) return;
        // Dismiss via Escape (universal).
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = !(await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/agents',
            interaction: 'Escape → modal closes',
            expected: 'dialog hidden',
            actual: closed ? 'dialog closed' : 'dialog still visible',
            passed: closed,
        });
    });

    test('modal: Shortcuts in top bar opens + closes', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        // Topbar Shortcuts is a `<Box tabIndex={0} role="button">` with
        // a Typography child showing "Shortcuts". Locate by visible
        // text within the topbar / page chrome — getByText with
        // exact match is the most resilient option.
        const trigger = page.getByText('Shortcuts', { exact: true }).first();
        const exists = (await trigger.count()) > 0;
        if (!exists) {
            record({
                captured_at: new Date().toISOString(),
                page: '/',
                interaction: 'find Shortcuts trigger',
                expected: 'button visible',
                actual: 'not found',
                passed: false,
            });
            return;
        }
        await trigger.click();
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
        const opened = (await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/',
            interaction: 'click Shortcuts → modal opens',
            expected: 'dialog visible',
            actual: opened ? 'dialog open' : 'dialog NOT visible',
            passed: opened,
        });
        if (!opened) return;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = !(await dialog.isVisible().catch(() => false));
        record({
            captured_at: new Date().toISOString(),
            page: '/',
            interaction: 'Escape → modal closes',
            expected: 'dialog hidden',
            actual: closed ? 'dialog closed' : 'dialog still visible',
            passed: closed,
        });
    });

    test('summary: findings exist', async () => {
        expect(existsSync(FINDINGS)).toBe(true);
    });
});
