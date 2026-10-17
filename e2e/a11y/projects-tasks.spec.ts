import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiPost } from '../helpers/api.js';
import { sql } from '../helpers/db.js';
import { setThemeMode } from '../helpers/theme.js';

// The Projects and Tasks routes, populated, at 390 / 834 / 1440 in light and
// dark: axe WCAG A/AA, no console errors, no sideways page scroll. Then the
// keyboard: Tab reaches every control; Enter / Space open menus and dialogs;
// arrows move inside a menu; Escape closes and hands focus back.
// Seeds onto the e2e project (a rule, a script, a markdown comment) and
// removes it afterwards.

const WIDTHS = [
    { w: 390, h: 844 },
    { w: 834, h: 1194 },
    { w: 1440, h: 900 },
] as const;

const P = '/projects/e2e-terminal-project';

interface View {
    name: string;
    path: string;
    ready: (page: Page) => Promise<void>;
}

const VIEWS: View[] = [
    { name: 'projects', path: '/projects', ready: async (p) => void (await expect(p.getByRole('heading', { name: 'E2E Terminal' })).toBeVisible()) },
    { name: 'project overview', path: P, ready: async (p) => void (await expect(p.getByText('Open tasks')).toBeVisible()) },
    { name: 'project tasks', path: `${P}?tab=tasks`, ready: async (p) => void (await expect(p.getByText(/Showing \d+ tasks? in this project/)).toBeVisible()) },
    { name: 'project guard-rails', path: `${P}?tab=guardrails`, ready: async (p) => void (await expect(p.getByText('A11y rule')).toBeVisible()) },
    { name: 'project repos', path: `${P}?tab=repos`, ready: async (p) => void (await expect(p.getByTestId('repo-row-project')).toBeVisible()) },
    { name: 'project jira', path: `${P}?tab=jira`, ready: async (p) => void (await expect(p.getByText('Status mapping')).toBeVisible()) },
    { name: 'project setup', path: `${P}?tab=setup`, ready: async (p) => void (await expect(p.getByRole('button', { name: 'Edit setup scripts for project' })).toBeVisible()) },
    { name: 'project history', path: `${P}?tab=history`, ready: async (p) => void (await expect(p.getByText(/agent activity/i).first()).toBeVisible()) },
    { name: 'tasks', path: '/tasks', ready: async (p) => void (await expect(p.getByText('E2E linked task').first()).toBeVisible()) },
    { name: 'new task', path: '/tasks/new', ready: async (p) => void (await expect(p.getByLabel('Title')).toBeVisible()) },
    { name: 'task detail', path: '/tasks/ETM-1', ready: async (p) => void (await expect(p.locator('table').filter({ hasText: 'north' })).toBeVisible()) },
    { name: 'sub-task detail', path: '/sub-tasks/ETM-2', ready: async (p) => void (await expect(p.getByRole('heading', { level: 1, name: 'E2E seeded sub-task' })).toBeVisible()) },
];

const LONG = 'y'.repeat(300);

test.beforeAll(async ({ request }) => {
    sql(`DELETE FROM project_guardrails WHERE project_id = 'e2e-terminal-project' AND title = 'A11y rule'`);
    sql(`DELETE FROM project_guardrail_scripts WHERE project_id = 'e2e-terminal-project' AND id = 'a11y-check'`);
    sql(`DELETE FROM comments WHERE body LIKE '%a11y-burrow%'`);
    await apiPost(request, '/api/projects/e2e-terminal-project/guardrails', { title: 'A11y rule', body_md: 'Keep every control reachable by keyboard.' });
    await apiPost(request, '/api/projects/e2e-terminal-project/guardrail-scripts', { id: 'a11y-check', name: 'A11y check', description: 'Exits 0', body_sh: 'exit 0', body_ps1: 'exit 0' });
    await apiPost(request, '/api/comments', {
        author: 'owner',
        issue_type: 'task',
        issue_id: 'ETM-1',
        body: `| Burrow | Depth |\n| --- | --- |\n| north | 2m |\n\n\`\`\`sh\necho a11y-burrow ${LONG}\n\`\`\``,
    });
});

test.afterAll(async ({ request }) => {
    for (const [id] of sql(`SELECT id FROM project_guardrails WHERE project_id = 'e2e-terminal-project' AND title = 'A11y rule'`)) {
        await request.delete(`${API}/api/projects/e2e-terminal-project/guardrails/${id}`);
    }
    await request.delete(`${API}/api/projects/e2e-terminal-project/guardrail-scripts/a11y-check`);
    sql(`DELETE FROM comments WHERE body LIKE '%a11y-burrow%'`);
});

type Violations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'];

/**
 * Drop the one app-wide finding this spec does not own: the Draft status chip
 * (`--atlas-status-draft-fg` #727a87 on `--atlas-status-draft-bg` #eef1f4,
 * 3.8:1) comes from the global theme tokens every page shares. It is listed
 * under "Open" in e2e/coverage/projects-tasks-matrix.md. Anything else —
 * including another colour pair on the same chip — still fails.
 */
function known(violations: Violations): Violations {
    return violations
        .map((v) =>
            v.id !== 'color-contrast'
                ? v
                : { ...v, nodes: v.nodes.filter((n) => !n.any.some((c) => (c.data as { fgColor?: string; bgColor?: string } | null)?.fgColor === '#727a87' && (c.data as { bgColor?: string }).bgColor === '#eef1f4')) },
        )
        .filter((v) => v.nodes.length > 0);
}

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
        // A region that scrolls on purpose (tables, pill rows, tab bars, code blocks) is fine; the page itself never.
        const scrolls = (e: Element) => {
            for (let n: Element | null = e.parentElement; n; n = n.parentElement) {
                const o = getComputedStyle(n).overflowX;
                if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
            }
            return false;
        };
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
                    await goto(page, v.path);
                    await v.ready(page);
                    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
                    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
                    await expect(page.locator('.MuiSkeleton-root')).toHaveCount(0);
                    // Colours are measured at rest, not halfway through a button's enable transition.
                    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
                    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
                    const summary = known(violations).map(
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
            await goto(page, v.path);
            await v.ready(page);
            await tabReachesEverything(page);
        });
    }

    test('keyboard focus draws a ring; a mouse press does not', async ({ page }) => {
        await goto(page, '/projects');
        const btn = page.getByRole('button', { name: 'New Project' });
        const outline = () => btn.evaluate((el) => getComputedStyle(el).outlineStyle);
        await btn.hover();
        await page.mouse.down();
        await expect(btn).toBeFocused();
        expect(await outline()).toBe('none');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(btn).toBeFocused();
        expect(await outline()).toBe('solid');
    });

    test('Projects: chips by Enter / Space, New Project opens by keyboard and Escape closes it', async ({ page }) => {
        await goto(page, '/projects');
        const chip = page.getByRole('button', { name: /^My queue \d+$/ });
        await chip.focus();
        await page.keyboard.press(' ');
        await page.getByRole('button', { name: /^All \d+$/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: 'E2E Terminal' })).toBeVisible();
        const newProject = page.getByRole('button', { name: 'New Project' });
        await newProject.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        // Focus lands inside the dialog (on its paper, not Name — see the matrix's Open list); Tab walks Close, then Name.
        await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog.getByLabel(/^Name/)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(newProject).toBeFocused();
    });

    test('Project actions: Enter opens, arrows walk the items, Escape closes and refocuses; tabs move with arrows', async ({ page }) => {
        await goto(page, P);
        const trigger = page.getByRole('button', { name: 'Project actions' });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: 'Rename project…' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Edit guard-rails' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: 'Manage Secrets' })).toBeFocused();
        await page.keyboard.press('Enter');
        const secrets = page.getByRole('dialog', { name: 'Project Secrets' });
        await expect(secrets).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(secrets).toHaveCount(0);

        await trigger.focus();
        await page.keyboard.press(' ');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();

        await page.getByRole('tab', { name: /Overview/ }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: /Tasks/ })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/tab=tasks/);
    });

    test('Tasks: the filter dropdowns open by Enter and close by Escape; a row opens by Enter', async ({ page }) => {
        await goto(page, '/tasks');
        const chip = page.getByRole('button', { name: /^Status:/ });
        await chip.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(chip).toBeFocused();
        await chip.focus();
        await page.keyboard.press(' ');
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/status=draft/);
        await chip.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: 'Any' }).press('Enter');
        await page.getByRole('button', { name: /E2E linked task/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/tasks\/ETM-1$/);
    });

    test('Task detail: the Status row and Task actions open by keyboard, Escape closes both', async ({ page }) => {
        await goto(page, '/tasks/ETM-1');
        const status = page.getByRole('button', { name: /^Status/ });
        await status.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu');
        await expect(menu).toContainText('Move to');
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(status).toBeFocused();

        const actions = page.getByRole('button', { name: 'Task actions' });
        await actions.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: 'Delete this task…' }).press('Enter');
        const confirm = page.getByRole('dialog');
        await expect(confirm.getByText('Delete this task?')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(confirm).toHaveCount(0);

        // The hover-only title and comment buttons still show when focused.
        const edit = page.getByRole('button', { name: 'Edit title' });
        await edit.focus();
        await expect(edit).toHaveCSS('opacity', '1');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Save title' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('heading', { level: 1, name: 'E2E linked task' })).toBeVisible();
    });
});
