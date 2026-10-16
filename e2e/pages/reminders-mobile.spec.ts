import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { setThemeMode } from '../helpers/theme.js';
import { expectActionsOnTitleRow, expectBoxesContainTheirContent, intersects, noHorizontalOverflow } from '../helpers/layout.js';

// Reminders against the real e2e API: the phone card (390px `mobile-chrome`, and
// 360px via setViewportSize; 834px on `ipad-chrome`),
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

// The fire log comes from a fixture: producing real fires needs the minute tick.
const FIRES = [
    {
        notification_id: 3,
        fired_at: new Date(Date.now() - 3_600_000).toISOString(),
        push_status: 'sent',
        external_status: 'failed',
        failure_reason:
            'Telegram: Forbidden: bot was blocked by the user, and this reason is long enough to need truncating on a phone',
    },
    { notification_id: 2, fired_at: new Date(Date.now() - 90_000_000).toISOString(), push_status: 'sent', external_status: 'sent', failure_reason: null },
    { notification_id: 1, fired_at: new Date(Date.now() - 180_000_000).toISOString(), push_status: 'none', external_status: 'pending', failure_reason: null },
];

async function layoutChecks(page: Page): Promise<void> {
    await expectActionsOnTitleRow(page);
    await noHorizontalOverflow(page);
    await expectBoxesContainTheirContent(page.getByTestId('reminder-row'));

    // Live and history cards keep at least 8px between them.
    const boxes = await page.getByTestId('reminder-row').evaluateAll((els) =>
        els.map((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        }),
    );
    for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.top - boxes[i - 1]!.bottom, `gap above card ${i}`).toBeGreaterThanOrEqual(8);
    }

    // The expand chevron and the ⋮ button never touch.
    const hist = row(page, OLD);
    const chevron = await hist.getByTestId(/ExpandMoreRoundedIcon/).boundingBox();
    const kebab = await hist.getByRole('button', { name: `Actions for ${OLD}` }).boundingBox();
    expect(chevron && kebab).toBeTruthy();
    expect(intersects(chevron!, kebab!), `chevron ${JSON.stringify(chevron)} kebab ${JSON.stringify(kebab)}`).toBe(false);

    // Fire log: one entry per fire — date on line 1, delivery chips on line 2 — none overlapping.
    const fires = hist.getByTestId('reminder-fire');
    await expect(fires).toHaveCount(FIRES.length);
    const fireBoxes = await fires.evaluateAll((els) =>
        els.map((el) => {
            const r = el.getBoundingClientRect();
            const [date, chips] = [...el.children].map((c) => c.getBoundingClientRect());
            return { top: r.top, bottom: r.bottom, dateBottom: date!.bottom, chipsTop: chips!.top };
        }),
    );
    for (const [i, f] of fireBoxes.entries()) {
        expect(f.chipsTop, `fire ${i}: chips under the date`).toBeGreaterThanOrEqual(f.dateBottom - 1);
        if (i > 0) expect(f.top, `fire ${i} starts below fire ${i - 1}`).toBeGreaterThanOrEqual(fireBoxes[i - 1]!.bottom - 1);
    }
    await expect(fires.first().getByText('Push sent')).toBeVisible();
    await expect(fires.first().getByText('External failed')).toBeVisible();
    // The reason is clamped to two lines; a tap shows the rest.
    const reason = fires.first().getByRole('button', { name: /bot was blocked/ });
    await expect(reason).toHaveAttribute('aria-expanded', 'false');
    await reason.click();
    await expect(reason).toHaveAttribute('aria-expanded', 'true');
}

test.describe('/reminders layout @mobile', () => {
    for (const width of [390, 360]) {
        test(`${width}px: header on one row, cards contained and spaced, fire log readable @mobile`, async ({
            page,
            request,
        }) => {
            await page.setViewportSize({ width, height: 844 });
            await page.route(/\/api\/reminders\/\d+\/fires/, (r) => r.fulfill({ json: FIRES }));
            await seed(request);
            await goto(page, '/reminders');
            await showHistory(page);
            await row(page, OLD).getByRole('button', { name: /show fire log/ }).click();
            await layoutChecks(page);
        });
    }

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

test.describe('/reminders layout @ipad', () => {
    test('834px: header on one row, cards contained and spaced, fire log readable @ipad', async ({ page, request }) => {
        await page.route(/\/api\/reminders\/\d+\/fires/, (r) => r.fulfill({ json: FIRES }));
        await seed(request);
        await goto(page, '/reminders');
        await showHistory(page);
        await row(page, OLD).getByRole('button', { name: /show fire log/ }).click();
        await layoutChecks(page);
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
