import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { setThemeMode } from '../helpers/theme.js';

// Reminders against the real e2e API: the phone card (390px, `mobile-chrome`),
// the desktop grid, pause / resume / snooze / delete through the row menu, the
// lazy fire log, and an axe pass in light and dark with history on.

interface Reminder {
    id: number;
    label: string;
    status: string;
    next_fire_at: string;
}

const LIVE = 'Stand-up with the platform team before the weekly planning review starts';
const PAUSED = 'Water the plants';
const OLD = 'Renew the TLS certificate on the staging load balancer before it lapses';

async function resetReminders(request: APIRequestContext): Promise<void> {
    const all = await apiGet<Reminder[]>(request, '/api/reminders');
    for (const r of all) {
        if (r.status === 'active' || r.status === 'paused') await request.delete(`${API}/api/reminders/${r.id}`);
        await request.delete(`${API}/api/reminders/${r.id}?hard=1`);
    }
}

async function seed(request: APIRequestContext): Promise<Record<string, Reminder>> {
    await resetReminders(request);
    const mk = (label: string, schedule: unknown, channel = 'notification') =>
        apiPost<Reminder>(request, '/api/reminders', { label, body: '', schedule, channel });
    const live = await mk(LIVE, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time_of_day: '09:30' }, 'both');
    const paused = await mk(PAUSED, { kind: 'daily', time_of_day: '18:00' });
    await request.patch(`${API}/api/reminders/${paused.id}`, { data: { status: 'paused' } });
    const old = await mk(OLD, { kind: 'daily', time_of_day: '08:00' }, 'external');
    await request.delete(`${API}/api/reminders/${old.id}`);
    return { live, paused, old };
}

async function showHistory(page: Page): Promise<void> {
    await page.getByRole('switch', { name: /show history/i }).check();
    await expect(page.getByRole('region', { name: 'History' })).toBeVisible();
}

async function menu(page: Page, label: string, item: string): Promise<void> {
    await page.getByRole('button', { name: `Actions for ${label}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
}

// reminders.spec.ts expects an empty list; leave none behind.
test.afterEach(async ({ request }) => {
    await resetReminders(request);
});

const row = (page: Page, label: string) => page.getByTestId('reminder-row').filter({ hasText: label });

for (const tag of ['', ' @mobile']) {
    test.describe(`/reminders flows${tag}`, () => {
        test(`pause, resume and snooze from the row menu${tag}`, async ({ page, request }) => {
            const { live } = await seed(request);
            await goto(page, '/reminders');
            await expect(row(page, LIVE).getByText('active')).toBeVisible();

            await menu(page, LIVE, 'Pause');
            await expect(row(page, LIVE).getByText('paused', { exact: true })).toBeVisible();
            await expect(row(page, LIVE).getByText(/Paused · never fired/)).toBeVisible();
            await menu(page, LIVE, 'Resume');
            await expect(row(page, LIVE).getByText('active')).toBeVisible();

            await menu(page, LIVE, 'Snooze 1 hour');
            await expect(row(page, LIVE).getByText(/^Next in (59m|1h)$/)).toBeVisible();
            const after = await apiGet<Reminder>(request, `/api/reminders/${live!.id}`);
            const mins = (new Date(after.next_fire_at).getTime() - Date.now()) / 60_000;
            expect(mins).toBeGreaterThan(55);
            expect(mins).toBeLessThan(61);
        });

        test(`history: tap for the fire log, delete with a confirm${tag}`, async ({ page, request }) => {
            const { old } = await seed(request);
            await goto(page, '/reminders');
            await showHistory(page);
            const hist = row(page, OLD);
            await expect(hist.getByText(/^Cancelled (just now|\dm ago)$/)).toBeVisible();

            await hist.getByRole('button', { name: /show fire log/ }).click();
            await expect(hist.getByText(/No fires logged/)).toBeVisible();

            await menu(page, OLD, 'Delete');
            const dialog = page.getByRole('dialog', { name: 'Delete reminder?' });
            await dialog.getByRole('button', { name: 'Delete reminder' }).click();
            await expect(row(page, OLD)).toHaveCount(0);
            const res = await request.get(`${API}/api/reminders/${old!.id}`);
            expect(res.status()).toBe(404);
        });
    });
}

test.describe('/reminders layout @mobile', () => {
    test('390px: no horizontal overflow; history cards are full width with a readable label @mobile', async ({
        page,
        request,
    }) => {
        await seed(request);
        await goto(page, '/reminders');
        await showHistory(page);
        await expect(row(page, OLD)).toBeVisible();
        const { scroll, client } = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
        }));
        expect(scroll).toBeLessThanOrEqual(client);

        const liveBox = await row(page, LIVE).boundingBox();
        const histBox = await row(page, OLD).boundingBox();
        expect(histBox && liveBox).toBeTruthy();
        expect(Math.abs(histBox!.width - liveBox!.width)).toBeLessThanOrEqual(1);
        expect(histBox!.width).toBeGreaterThan(client - 40);

        // The label wraps to (at most) two lines instead of being squeezed into a grid column.
        const label = row(page, OLD).getByText(OLD);
        const lb = await label.boundingBox();
        expect(lb!.width).toBeGreaterThan(200);
        expect(lb!.height).toBeGreaterThan(18);
        // History is a muted surface at full opacity.
        const opacity = await row(page, OLD).evaluate((el) => getComputedStyle(el).opacity);
        expect(opacity).toBe('1');
        // The ⋮ button never sits on top of the time line text.
        const time = await row(page, OLD).getByText(/^Cancelled/).boundingBox();
        const kebab = await row(page, OLD).getByRole('button', { name: `Actions for ${OLD}` }).boundingBox();
        expect(time!.x + time!.width).toBeLessThanOrEqual(kebab!.x);
    });
});

for (const mode of ['light', 'dark'] as const) {
    test.describe(`/reminders axe · ${mode}`, () => {
        for (const tag of ['', ' @mobile']) {
            test(`no WCAG A/AA violations with history open (${mode})${tag}`, async ({ page, request }) => {
                await setThemeMode(page, mode);
                await seed(request);
                await goto(page, '/reminders');
                await showHistory(page);
                await row(page, OLD).getByRole('button', { name: /show fire log/ }).click();
                await expect(row(page, OLD).getByText(/No fires logged/)).toBeVisible();
                await page.waitForTimeout(300);
                const { violations } = await new AxeBuilder({ page })
                    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                    .analyze();
                const summary = violations.map(
                    (v) =>
                        `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes
                            .slice(0, 3)
                            .map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`)
                            .join(' | ')}`,
                );
                expect(summary, summary.join('\n')).toEqual([]);
            });
        }
    });
}
