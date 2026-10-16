import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { routeAnalytics } from '../fixtures/analytics-fixtures.js';

// /analytics — four URL-synced tabs over one window. The e2e DB is too small
// to draw real charts, so the three summary endpoints are routed to realistic
// fixtures (e2e/fixtures/analytics-fixtures.ts); the drill-down pages stay on
// the real API.

const TABS = [
    { key: 'overview', name: /Overview/, marker: /Shipped and spent, per/ },
    { key: 'delivery', name: /Delivery/, marker: /Throughput per/ },
    { key: 'workflows', name: /Workflows & agents/, marker: 'How runs ended' },
    { key: 'spend', name: /Spend/, marker: 'Cost by model' },
] as const;

async function open(page: Page, path: string) {
    await goto(page, path);
}

test.describe('/analytics — tabs and window', () => {
    test('deep links select the tab and window, and only that tab fetches', async ({ page }) => {
        const seen = await routeAnalytics(page);
        await open(page, '/analytics?tab=delivery&window=7d');
        await expect(page.getByRole('heading', { name: 'Throughput per day' })).toBeVisible();
        await expect(page.getByRole('tab', { name: /Delivery/ })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
        expect(seen).toEqual(['/api/analytics/delivery?window=7d']);
    });

    test('clicking tabs and the window picker writes them to the URL', async ({ page }) => {
        const seen = await routeAnalytics(page);
        await open(page, '/analytics');
        await expect(page.getByRole('heading', { name: 'Shipped and spent, per day' })).toBeVisible();
        for (const t of TABS.slice(1)) {
            await page.getByRole('tab', { name: t.name }).click();
            await expect(page).toHaveURL(new RegExp(`tab=${t.key}`));
            await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
        }
        await page.getByRole('button', { name: '90 days' }).click();
        await expect(page).toHaveURL(/tab=spend&window=90d/);
        await expect.poll(() => seen).toContain('/api/analytics?window=90d');
        await page.getByRole('button', { name: 'This month' }).click();
        await expect(page).not.toHaveURL(/window=/);
    });

    test('every metric tile states its definition', async ({ page }) => {
        await routeAnalytics(page);
        await open(page, '/analytics?tab=delivery');
        const info = page.getByRole('button', { name: 'How Cycle time, median is measured' });
        await info.hover();
        await expect(page.getByRole('tooltip')).toContainText('first move into In progress');
    });

    test('a project row drills down to its analytics page', async ({ page }) => {
        await routeAnalytics(page);
        await open(page, '/analytics?tab=delivery');
        await page.getByRole('table', { name: 'Delivery by project' }).getByRole('link', { name: 'Storefront' }).click();
        await expect(page).toHaveURL(/\/analytics\/project\/e2e-terminal-project$/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test('a WIP row opens the Task', async ({ page }) => {
        await routeAnalytics(page);
        await open(page, '/analytics?tab=delivery');
        await page.getByRole('link', { name: 'ETM-1', exact: true }).click();
        await expect(page).toHaveURL(/\/tasks\/ETM-1$/);
    });

    test('an empty window reads as empty, not broken', async ({ page }) => {
        await routeAnalytics(page, { empty: true });
        await open(page, '/analytics?tab=delivery');
        await expect(page.getByText('Nothing shipped in this window').first()).toBeVisible();
        await expect(page.getByText('No project shipped a Task in this window.')).toBeVisible();
    });

    test('against the real API, every tab renders without errors', async ({ page }) => {
        for (const t of TABS) {
            await open(page, `/analytics?tab=${t.key}&window=90d`);
            await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
        }
    });
});

for (const mode of ['light', 'dark'] as const) {
    test.describe(`/analytics axe · ${mode}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.addInitScript((m) => localStorage.setItem('atlas.themeMode', m), mode);
            await routeAnalytics(page);
        });
        for (const t of TABS) {
            test(`${t.key} has no WCAG A/AA violations (${mode})`, async ({ page }) => {
                await open(page, `/analytics?tab=${t.key}`);
                await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
                await page.waitForTimeout(800);
                const { violations } = await new AxeBuilder({ page })
                    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                    .analyze();
                const summary = violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
                expect(summary, summary.join('\n')).toEqual([]);
            });
        }
    });
}

test.describe('/analytics on a phone @mobile', () => {
    for (const t of TABS) {
        test(`${t.key} fits the screen with no sideways scroll @mobile`, async ({ page }) => {
            await routeAnalytics(page);
            await open(page, `/analytics?tab=${t.key}`);
            await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
            await page.waitForTimeout(500);
            const overflow = await page.evaluate(() => {
                const doc = document.documentElement;
                const offenders = [...document.body.querySelectorAll('*')]
                    .filter((e) => !e.closest('[role="region"]') && !e.closest('[role="tablist"]') && e.getBoundingClientRect().right > window.innerWidth + 1)
                    .slice(0, 3)
                    .map((e) => e.tagName + '.' + String(e.className).slice(0, 40));
                return { scroll: doc.scrollWidth - doc.clientWidth, offenders };
            });
            expect(overflow).toEqual({ scroll: 0, offenders: [] });
        });
    }

    test('tiles sit two to a row and the tabs scroll @mobile', async ({ page }) => {
        await routeAnalytics(page);
        await open(page, '/analytics');
        const tiles = page.getByRole('button', { name: /^How .* is measured$/ });
        await expect(tiles).toHaveCount(6);
        const a = await tiles.nth(0).boundingBox();
        const b = await tiles.nth(1).boundingBox();
        expect(a && b && Math.abs(a.y - b.y) < 4).toBe(true);
        await page.getByRole('tab', { name: /Spend/ }).click();
        await expect(page.getByRole('heading', { name: 'Cost by model' })).toBeVisible();
    });
});
