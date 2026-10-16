import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';

// Notifications at phone width (390px, the `mobile-chrome` project) plus the
// click routing and an axe pass on both widths. The list is served from a
// fixture through page.route so every card shape is present (held, failed,
// long message, no item) without seeding producers that need a CLI, Jira or a
// quiet-hours window.

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function row(over: Record<string, unknown>) {
    return {
        id: 1,
        event_type: 'workflow_run',
        message:
            'Delivery needs you on ATL-12: the reviewer asked which API version to target before it can continue.',
        issue_type: null,
        issue_id: null,
        project_id: null,
        sent_external: 0,
        kind: 'update',
        agent_id: null,
        external_status: 'none',
        failure_reason: null,
        push_status: 'none',
        push_failure_reason: null,
        read_at: null,
        link_url: null,
        external_deferred_at: null,
        created_at: ago(5),
        ...over,
    };
}

const ROWS = [
    row({
        id: 11,
        kind: 'needs_you',
        issue_type: 'task',
        issue_id: 'ATL-12',
        link_url: '/workflows/wf-e2e/runs/run-e2e',
        external_status: 'pending',
        external_deferred_at: ago(4),
        created_at: ago(4),
    }),
    row({
        id: 12,
        event_type: 'jira_sync',
        kind: 'needs_you',
        message:
            'Jira sync failed: Jira rejected the credentials (401). Check the API token in Settings → Jira.',
        link_url: '/settings?tab=jira',
        external_status: 'failed',
        failure_reason: 'Telegram: Forbidden: bot was blocked by the user',
        created_at: ago(30),
    }),
    row({
        id: 13,
        event_type: 'reminder',
        kind: 'system',
        message: 'Stand-up notes',
        link_url: '/reminders',
        external_status: 'sent',
        read_at: ago(1),
        created_at: ago(90),
    }),
    row({
        id: 14,
        event_type: 'autofetch_failed',
        kind: 'system',
        message:
            'Auto-fetch on "Atlas/web": fetch failed: remote hung up unexpectedly while reading the pack header from origin.',
        project_id: 'p-e2e',
        link_url: '/projects/p-e2e',
        external_status: 'sent',
        created_at: ago(600),
    }),
    row({
        id: 15,
        event_type: 'terminal.waiting_for_input',
        kind: 'needs_you',
        message: 'Terminal "fix flaky test" has been idle and may be waiting for your input.',
        link_url: '/terminal/s-e2e',
        created_at: ago(2000),
    }),
];

async function serveFixture(page: Page): Promise<void> {
    await page.route(
        (url) => url.pathname === '/api/notifications',
        (r) => r.fulfill({ json: ROWS })
    );
    await page.route(/\/api\/notifications\/\d+\/read$/, (r) =>
        r.fulfill({ json: { ok: true, changed: true } })
    );
    // Quiet hours on, so the held row can name its send time.
    await page.route(
        (url) => url.pathname === '/api/settings',
        async (r) => {
            if (r.request().method() !== 'GET') return r.continue();
            const res = await r.fetch();
            const body = (await res.json()) as Record<string, unknown>;
            await r.fulfill({
                response: res,
                json: {
                    ...body,
                    quiet_hours_enabled: 1,
                    quiet_hours_from: '22:00',
                    quiet_hours_to: '08:00',
                },
            });
        }
    );
}

async function noHorizontalOverflow(page: Page): Promise<void> {
    const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
}

test.describe('/notifications @mobile', () => {
    test.beforeEach(async ({ page }) => {
        await serveFixture(page);
    });

    test('header actions are icon buttons on one row @mobile', async ({ page }) => {
        await goto(page, '/notifications');
        const names = ['Refresh notifications', 'Notification settings', 'Mark all read'];
        const tops: number[] = [];
        for (const name of names) {
            const btn = page.getByRole('button', { name, exact: true });
            await expect(btn).toBeVisible();
            tops.push(await btn.evaluate((el) => Math.round(el.getBoundingClientRect().top)));
        }
        expect(new Set(tops).size, `tops: ${tops.join(', ')}`).toBe(1);
    });

    for (const tab of ['external', 'in-app'] as const) {
        test(`${tab} tab: no horizontal overflow, pills scroll in one row, cards line up @mobile`, async ({
            page,
        }) => {
            await goto(page, `/notifications?tab=${tab}`);
            const cards = page.getByTestId('notification-card');
            await expect(cards.first()).toBeVisible();
            await noHorizontalOverflow(page);

            const pills = page.getByRole('group', {
                name: tab === 'external' ? 'Filter deliveries' : 'Filter notifications',
            });
            const pillTops = await pills
                .locator(':scope > *')
                .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
            expect(new Set(pillTops).size).toBe(1);

            const boxes = await cards.evaluateAll((els) =>
                els.map((el) => {
                    const r = el.getBoundingClientRect();
                    const icon = el.firstElementChild?.getBoundingClientRect();
                    const action = el.lastElementChild?.getBoundingClientRect();
                    return {
                        left: Math.round(r.left),
                        width: Math.round(r.width),
                        icon: Math.round(icon?.width ?? 0),
                        action: Math.round(action?.width ?? 0),
                    };
                })
            );
            expect(boxes.length).toBeGreaterThan(1);
            // Same left edge, same width, same icon and action tracks on every card.
            for (const b of boxes) expect(b).toEqual(boxes[0]);
            expect(boxes[0]?.icon).toBe(32);
            expect(boxes[0]?.action).toBe(40);
        });
    }

    test('the held row says so and names its send time @mobile', async ({ page }) => {
        await goto(page, '/notifications?tab=external');
        const held = page
            .getByTestId('notification-card')
            .filter({ hasText: 'Held · quiet hours' });
        await expect(held).toHaveCount(1);
        await expect(held).toContainText('sends 08:00');
        await expect(held.getByRole('button', { name: 'Cancel' })).toBeVisible();
    });
});

test.describe('/notifications feed routing', () => {
    test.beforeEach(async ({ page }) => {
        await serveFixture(page);
    });

    const cases: Array<[string, RegExp]> = [
        ['Stand-up notes', /\/reminders$/],
        ['Jira sync failed', /\/settings\?tab=jira$/],
        ['Delivery needs you on ATL-12', /\/workflows\/wf-e2e\/runs\/run-e2e$/],
    ];
    for (const [text, url] of cases) {
        test(`clicking "${text}" opens ${url.source}`, async ({ page }) => {
            await goto(page, '/notifications?tab=in-app');
            await page.getByTestId('notification-card').filter({ hasText: text }).click();
            await expect(page).toHaveURL(url);
        });
        test(`clicking "${text}" opens ${url.source} @mobile`, async ({ page }) => {
            await goto(page, '/notifications?tab=in-app');
            await page.getByTestId('notification-card').filter({ hasText: text }).click();
            await expect(page).toHaveURL(url);
        });
    }
});

for (const mode of ['light', 'dark'] as const) {
    test.describe(`/notifications axe · ${mode}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.addInitScript((m) => localStorage.setItem('atlas.themeMode', m), mode);
            await serveFixture(page);
        });
        for (const tab of ['external', 'in-app'] as const) {
            for (const tag of ['', ' @mobile']) {
                test(`${tab} tab has no WCAG A/AA violations (${mode})${tag}`, async ({ page }) => {
                    await goto(page, `/notifications?tab=${tab}`);
                    await expect(page.getByText('Stand-up notes').first()).toBeVisible();
                    await page.waitForTimeout(500);
                    const { violations } = await new AxeBuilder({ page })
                        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                        .analyze();
                    const summary = violations.map(
                        (v) =>
                            `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes
                                .slice(0, 3)
                                .map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`)
                                .join(' | ')}`
                    );
                    expect(summary, summary.join('\n')).toEqual([]);
                });
            }
        }
    });
}
