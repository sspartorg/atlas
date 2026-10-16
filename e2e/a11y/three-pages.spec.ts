import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiPost } from '../helpers/api.js';
import { insertNotifications, sql } from '../helpers/db.js';
import { setThemeMode } from '../helpers/theme.js';
import { routeAnalytics } from '../fixtures/analytics-fixtures.js';

// Notifications, Reminders, Analytics (+ drill-downs) and Settings →
// Notifications, populated, at 390 / 834 / 1440 in light and dark: axe WCAG
// A/AA, no console errors, no sideways page scroll. Then the keyboard: Tab
// reaches every control, Enter / Space activate, Escape closes menus, dialogs
// and the topbar popover.

const WIDTHS = [
    { w: 390, h: 844 },
    { w: 834, h: 1194 },
    { w: 1440, h: 900 },
] as const;

interface View {
    name: string;
    path: string;
    ready: (page: Page) => Promise<void>;
    analytics?: boolean;
}

const VIEWS: View[] = [
    { name: 'notifications log', path: '/notifications', ready: async (p) => void (await expect(p.getByText('Row held').first()).toBeVisible()) },
    { name: 'notifications feed', path: '/notifications?tab=in-app', ready: async (p) => void (await expect(p.getByText('Needs you').first()).toBeVisible()) },
    {
        name: 'reminders + history',
        path: '/reminders',
        ready: async (p) => {
            await p.getByRole('switch', { name: 'Show history' }).check();
            await expect(p.getByRole('region', { name: 'History' }).getByTestId('reminder-row')).toHaveCount(1);
        },
    },
    { name: 'analytics overview', path: '/analytics', analytics: true, ready: async (p) => void (await expect(p.getByRole('heading', { name: /^Shipped and spent/ })).toBeVisible()) },
    { name: 'analytics delivery', path: '/analytics?tab=delivery', analytics: true, ready: async (p) => void (await expect(p.getByRole('heading', { name: /^Throughput per/ })).toBeVisible()) },
    { name: 'analytics workflows', path: '/analytics?tab=workflows', analytics: true, ready: async (p) => void (await expect(p.getByRole('heading', { name: 'How runs ended' })).toBeVisible()) },
    { name: 'analytics spend', path: '/analytics?tab=spend', analytics: true, ready: async (p) => void (await expect(p.getByRole('heading', { name: 'Cost by model' })).toBeVisible()) },
    { name: 'analytics project', path: '/analytics/project/e2e-terminal-project', ready: async (p) => void (await expect(p.getByText('E2E Terminal').first()).toBeVisible()) },
    { name: 'analytics task', path: '/analytics/task/ETM-1', ready: async (p) => void (await expect(p.getByText('E2E linked task').first()).toBeVisible()) },
    { name: 'settings notifications', path: '/settings?tab=notifications', ready: async (p) => void (await expect(p.getByText('Quiet Hours').first()).toBeVisible()) },
];

async function seed(request: APIRequestContext): Promise<void> {
    sql('DELETE FROM notifications');
    insertNotifications([
        { event_type: 'workflow_run', message: 'Row sent: Delivery finished ETM-1 and opened its pull request for review', item_id: 'ETM-1', external_status: 'sent' },
        { event_type: 'agent_error', message: 'Row failed', kind: 'needs_you', item_id: 'ETM-2', external_status: 'failed', failure_reason: 'Telegram: Forbidden: bot was blocked by the user' },
        { event_type: 'reminder', message: 'Row held', kind: 'system', external_status: 'pending', deferred: true },
        { event_type: 'mcp_external', message: 'Row skipped', kind: 'system', failure_reason: 'Skipped: event turned off while held', in_app: false },
        { event_type: 'jira_sync', message: 'Jira sync failed: Jira rejected the credentials (401)', kind: 'needs_you', read: true },
        { event_type: 'autofetch_failed', message: 'Auto-fetch failed: remote hung up', kind: 'system', project_id: 'e2e-terminal-project' },
    ]);
    const all = (await (await request.get(`${API}/api/reminders?limit=500`)).json()) as Array<{ id: number; status: string }>;
    for (const r of all) {
        if (r.status === 'active' || r.status === 'paused') await request.delete(`${API}/api/reminders/${r.id}`);
        await request.delete(`${API}/api/reminders/${r.id}?hard=1`);
    }
    await apiPost(request, '/api/reminders', { label: 'Stand-up with the platform team before planning', body: 'Bring the release notes', schedule: { kind: 'weekly', weekdays: [1, 3, 5], time_of_day: '09:30' }, channel: 'both' });
    const old = await apiPost<{ id: number }>(request, '/api/reminders', { label: 'Renew the TLS certificate', body: '', schedule: { kind: 'cron', expr: '0 8 1 * *' }, channel: 'external' });
    await request.delete(`${API}/api/reminders/${old.id}`);
}

test.beforeAll(async ({ request }) => seed(request));
test.afterAll(async ({ request }) => {
    sql('DELETE FROM notifications');
    const all = (await (await request.get(`${API}/api/reminders?limit=500`)).json()) as Array<{ id: number; status: string }>;
    for (const r of all) {
        if (r.status === 'active' || r.status === 'paused') await request.delete(`${API}/api/reminders/${r.id}`);
        await request.delete(`${API}/api/reminders/${r.id}?hard=1`);
    }
});

/** Console errors and page errors for the whole test, not just the load. */
function watchConsole(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    return errors;
}

async function overflow(page: Page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        // A region that scrolls on purpose (tables, pill rows, tab bars) is fine; the page itself never.
        const scrolls = (e: Element) => !!e.closest('[role="region"], [role="tablist"], [role="group"], .MuiTabs-scroller, .recharts-wrapper');
        const offenders = [...document.body.querySelectorAll('*')]
            // MUI's switch input is a transparent 300%-wide hit area inside its track.
            .filter((e) => !scrolls(e) && getComputedStyle(e).opacity !== '0' && e.getClientRects().length > 0 && e.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 3)
            .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`);
        return { scroll: doc.scrollWidth - doc.clientWidth, offenders };
    });
}

for (const mode of ['light', 'dark'] as const) {
    for (const size of WIDTHS) {
        test.describe(`${mode} · ${size.w}px`, () => {
            test.use({ viewport: { width: size.w, height: size.h } });
            for (const v of VIEWS) {
                test(`${v.name}: axe A/AA clean, no console errors, no sideways scroll`, async ({ page }) => {
                    const errors = watchConsole(page);
                    await setThemeMode(page, mode);
                    if (v.analytics) await routeAnalytics(page);
                    await goto(page, v.path);
                    await v.ready(page);
                    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
                    // Charts and lazy chunks settle before axe reads colours.
                    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
                    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
                    const summary = violations.map(
                        (x) => `${x.id} (${x.impact}) ×${x.nodes.length}: ${x.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.html.slice(0, 140)}`).join(' | ')}`,
                    );
                    expect(summary, summary.join('\n')).toEqual([]);
                    expect(await overflow(page)).toEqual({ scroll: 0, offenders: [] });
                    expect(errors).toEqual([]);
                });
            }
        });
    }
}

// ── Keyboard ───────────────────────────────────────────────────────────────

/** Tab from the top until every visible tabbable control has had focus. */
async function tabReachesEverything(page: Page): Promise<void> {
    const total = await page.evaluate(() => {
        const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
            if (e.getAttribute('tabindex') === '-1' || e.closest('[aria-hidden="true"], [inert]')) return false;
            if (e instanceof HTMLInputElement && e.type === 'radio' && !e.checked) return false;
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        });
        els.forEach((e, i) => e.setAttribute('data-kb', String(i)));
        (document.activeElement as HTMLElement | null)?.blur();
        return els.length;
    });
    expect(total).toBeGreaterThan(5);
    const reached = new Set<string>();
    for (let i = 0; i < total * 2 + 20 && reached.size < total; i++) {
        await page.keyboard.press('Tab');
        const k = await page.evaluate(() => document.activeElement?.closest('[data-kb]')?.getAttribute('data-kb') ?? null);
        if (k !== null) reached.add(k);
    }
    const missed = await page.evaluate(
        (got) => [...document.querySelectorAll('[data-kb]')].filter((e) => !got.includes(e.getAttribute('data-kb') ?? '')).map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 50)),
        [...reached],
    );
    expect(missed, `never reached by Tab: ${missed.join(' | ')}`).toEqual([]);
}

test.describe('keyboard', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    for (const v of VIEWS) {
        test(`${v.name}: Tab reaches every control`, async ({ page }) => {
            if (v.analytics) await routeAnalytics(page);
            await goto(page, v.path);
            await v.ready(page);
            await tabReachesEverything(page);
        });
    }

    test('Notifications: Enter / Space activate; arrows move between tabs; Escape closes the popover', async ({ page }) => {
        await goto(page, '/notifications');
        const inApp = page.getByRole('tab', { name: 'In-App Feed' });
        await page.getByRole('tab', { name: 'Notification Log' }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(inApp).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/tab=in-app/);
        const pill = page.getByRole('group', { name: 'Filter notifications' }).getByRole('button', { name: /^Needs You/ });
        await pill.focus();
        await page.keyboard.press(' ');
        await expect(page.getByTestId('notification-card')).toHaveCount(2);

        const status = page.getByRole('button', { name: 'Notifications', exact: true });
        await status.focus();
        await page.keyboard.press('Enter');
        const pop = page.getByRole('dialog', { name: 'Notifications status' });
        await expect(pop).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await status.focus();
        await page.keyboard.press(' ');
        await expect(pop).toBeVisible();
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Mark All Read' }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText(/^Marked \d+ notifications? read$/)).toBeVisible();
        await seed(page.request);
    });

    test('Reminders: the row menu and both dialogs open from the keyboard and Escape closes them', async ({ page }) => {
        await goto(page, '/reminders');
        const kebab = page.getByRole('button', { name: /^Actions for Stand-up/ });
        await kebab.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem').first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Pause' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(kebab).toBeFocused();

        await page.keyboard.press(' ');
        await page.getByRole('menuitem', { name: 'Cancel reminder' }).press('Enter');
        const confirm = page.getByRole('dialog', { name: 'Cancel reminder?' });
        await expect(confirm).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(confirm).toHaveCount(0);

        await page.getByRole('button', { name: 'New reminder' }).focus();
        await page.keyboard.press('Enter');
        const modal = page.getByRole('dialog', { name: 'New reminder' });
        await expect(modal.getByLabel('Label')).toBeFocused();
        await page.keyboard.type('Typed with the keyboard');
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0);

        // The history switch and a history row's fire log toggle by keyboard.
        await page.getByRole('switch', { name: 'Show history' }).focus();
        await page.keyboard.press(' ');
        const log = page.getByRole('button', { name: /Renew the TLS certificate — show fire log/ });
        await log.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: /Renew the TLS certificate — hide fire log/ })).toHaveAttribute('aria-expanded', 'true');
    });

    test('Analytics: arrows move between tabs, the window buttons and info tooltips work by keyboard', async ({ page }) => {
        await routeAnalytics(page);
        await goto(page, '/analytics');
        await page.getByRole('tab', { name: /Overview/ }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: /Delivery/ })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: /^Throughput per/ })).toBeVisible();
        await page.getByRole('button', { name: '7 days', exact: true }).focus();
        await page.keyboard.press('Space');
        await expect(page).toHaveURL(/window=7d/);
        await page.getByRole('button', { name: 'How Reopen rate is measured' }).focus();
        await expect(page.getByRole('tooltip')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('tooltip')).toHaveCount(0);
    });
});
