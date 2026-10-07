import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { goto } from '../helpers/nav.js';
import { setThemeMode } from '../helpers/theme.js';

// The generator for every image in docs/guide/images.
//
// It photographs the GUIDE stack, not the e2e one: real agent runs on an
// isolated database, so no image shows the SIMULATED chip, canned run output,
// or the Owner's own projects. Bring it up and fill it first:
//
//   pnpm guide:stack up
//   pnpm guide:populate        # real runs — spends tokens
//   pnpm guide:capture
//   pnpm guide:stack drop
//
// Gated behind GUIDE=1 so `pnpm e2e` never rewrites tracked binaries.
//
// FULL PAGE. Content scrolls inside the app shell's own box (App.tsx
// `scrollRef`), not the document, so Playwright's `fullPage` only ever sees one
// viewport. `shoot` grows the viewport to fit that box instead, so every image
// is the whole window — sidebar, top bar and all of the page — and the
// virtualised lists render every row because they are all "on screen".
//
// ORDER IS LOAD-BEARING. Onboarding is captured last: clearing it makes
// RouteGuard redirect every route to /onboarding, and `assertNotOnboarding`
// fails any capture that lands there anyway, because the failure mode is a
// plausible-looking wrong image rather than an error.

const OUT = join(process.cwd(), 'docs', 'guide', 'images');
const WIDTH = 1440;
// Tall enough for the whole sidenav, so a page that fits never grows.
const BASE_HEIGHT = 960;
// A page taller than this is a list that never ends; the guide wants its top.
const MAX_HEIGHT = 4200;
const API = 'http://127.0.0.1:6001';
const PROJECT = 'acme-notes';

const enabled = process.env['GUIDE'] === '1';

/**
 * Let the shell's scroll box (the widest element that scrolls vertically) and
 * every ancestor grow to their content, so the DOCUMENT scrolls and `fullPage`
 * sees all of it. Only heights change: a box as tall as its content has nothing
 * to scroll, and leaving `overflow` alone keeps a wide board (kanban) scrolling
 * sideways inside the page instead of widening the whole window. Each keeps its on-screen height as a minimum, so a
 * fill-the-window page (builder canvas, terminal) keeps its real size instead
 * of being stretched the way a taller viewport stretches it. `__guideUndo` puts it back.
 */
async function unclip(page: Page): Promise<void> {
    await page.evaluate(() => {
        let box: HTMLElement | null = null;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const oy = getComputedStyle(el).overflowY;
            if (oy !== 'auto' && oy !== 'scroll') continue;
            if (el.clientWidth < 700 || el.clientHeight < 300) continue;
            if (!box || el.clientWidth > box.clientWidth) box = el;
        }
        const saved: Array<[HTMLElement, string]> = [];
        for (let el: HTMLElement | null = box; el; el = el.parentElement) {
            saved.push([el, el.style.cssText]);
            el.style.minHeight = `${el.clientHeight}px`;
            el.style.height = 'auto';
            el.style.maxHeight = 'none';
        }
        // Sticky and fixed bits pin to the OLD viewport and would land
        // mid-image: a sticky side card flows in place, and a fixed footer
        // (Guard-rails' save bar) anchors to the bottom of its page instead,
        // which already reserves room for it.
        if (box) {
            for (const el of Array.from(box.querySelectorAll<HTMLElement>('*'))) {
                const pos = getComputedStyle(el).position;
                if (pos !== 'sticky' && pos !== 'fixed') continue;
                saved.push([el, el.style.cssText]);
                el.style.position = pos === 'sticky' ? 'static' : 'absolute';
            }
        }
        // The sidenav is pinned at 100vh; let it stretch with the page so the
        // image shows one continuous window rather than a sidebar that stops.
        const aside = document.querySelector<HTMLElement>('aside');
        if (aside) {
            saved.push([aside, aside.style.cssText]);
            aside.style.height = 'auto';
        }
        (window as unknown as { __guideUndo: () => void }).__guideUndo = () => {
            for (const [el, css] of saved) el.style.cssText = css;
        };
    });
}

/**
 * `window`: photograph the window as-is. For a dialog — its backdrop is fixed
 * to the viewport, so a page grown past it would show a half-dimmed image.
 */
async function shoot(page: Page, name: string, mode: 'page' | 'window' = 'page'): Promise<void> {
    await expect(page.getByText('SIMULATED', { exact: true }), `${name} shows the SIMULATED chip`).toHaveCount(0);
    if (mode === 'window') {
        await page.screenshot({ path: join(OUT, `${name}.png`) });
        return;
    }
    await unclip(page);
    // Virtualised lists render the rows that are now "on screen".
    await page.waitForTimeout(600);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({
        path: join(OUT, `${name}.png`),
        fullPage: true,
        clip: { x: 0, y: 0, width: WIDTH, height: Math.min(height, MAX_HEIGHT) },
    });
    await page.evaluate(() => (window as unknown as { __guideUndo: () => void }).__guideUndo());
}

/** Settle async content so a capture never catches a skeleton mid-swap. */
async function settle(page: Page): Promise<void> {
    await page.waitForTimeout(1200);
}

async function assertNotOnboarding(page: Page, name: string): Promise<void> {
    expect(page.url(), `${name} captured the onboarding redirect, not its page`).not.toContain('/onboarding');
}

async function open(page: Page, path: string, name: string, ready?: (p: Page) => Promise<void>): Promise<void> {
    await goto(page, path, { allow: [/ERR_ABORTED/, /Failed to load resource/] });
    await assertNotOnboarding(page, name);
    if (ready) await ready(page);
    await settle(page);
}

async function capture(page: Page, path: string, name: string, ready?: (p: Page) => Promise<void>): Promise<void> {
    await open(page, path, name, ready);
    await shoot(page, name);
}

const text = (t: string | RegExp) => async (p: Page) => {
    await expect(p.getByText(t).first()).toBeVisible({ timeout: 15_000 });
};

async function api<T>(page: Page, path: string): Promise<T> {
    const res = await page.request.get(`${API}${path}`);
    expect(res.ok(), `GET ${path}`).toBe(true);
    return (await res.json()) as T;
}

type Wf = { id: string; name: string; input_kind?: string };
type Agent = { id: string; name: string };
type Run = { id: string; workflow_id: string; status: string };

test.describe('@guide capture the user-guide screenshots', () => {
    test.skip(!enabled, 'set GUIDE=1 to regenerate docs/guide/images');
    test.use({ viewport: { width: WIDTH, height: BASE_HEIGHT } });
    test.setTimeout(180_000);

    test.beforeAll(() => {
        mkdirSync(OUT, { recursive: true });
    });

    test('dashboard', async ({ page }) => {
        await capture(page, '/', 'doc-03-dashboard', text(/awaiting you/i));
    });

    test('credentials', async ({ page }) => {
        await capture(page, '/settings/credentials', 'doc-04-credentials', text('Acme GitHub (bot)'));
        await page.getByRole('button', { name: /add credential/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-05-credential-modal', 'window');
    });

    test('projects', async ({ page }) => {
        await capture(page, '/projects', 'doc-06-projects', text('Acme Notes'));
        await page.getByRole('button', { name: /new project/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-07-new-project', 'window');
        await capture(page, `/projects/${PROJECT}?tab=overview`, 'doc-08-project-overview', text('Acme Notes'));
        await capture(page, `/projects/${PROJECT}?tab=repos`, 'doc-09-project-repos', text('notes-web'));
        await capture(page, `/projects/${PROJECT}?tab=setup`, 'doc-10-project-setup', text(/default workflow/i));
        await capture(page, `/projects/${PROJECT}?tab=jira`, 'doc-38-project-jira');
        await capture(page, `/projects/${PROJECT}?tab=guardrails`, 'doc-49-project-guardrails');
    });

    test('settings', async ({ page }) => {
        await capture(page, '/settings?tab=profile', 'doc-50-settings-profile', text('Alex Rivera'));
        await capture(page, '/settings?tab=environment', 'doc-51-settings-environment');
        await capture(page, '/settings?tab=secrets', 'doc-11-settings-secrets', text('2 secrets'));
        await capture(page, '/settings?tab=models', 'doc-52-settings-models');
        await capture(page, '/settings?tab=notifications', 'doc-53-settings-notifications');
        await capture(page, '/settings?tab=jira', 'doc-39-settings-jira');
        await capture(page, '/settings?tab=help', 'doc-54-settings-help');
    });

    test('marketplace and mcp tools', async ({ page }) => {
        await capture(page, '/agents/marketplace?tab=agents', 'doc-12-marketplace');
        await capture(page, '/agents/marketplace?tab=workflows', 'doc-13-marketplace-workflows', text(/quick change/i));
        await capture(page, '/agents/marketplace/workflows/delivery', 'doc-14-marketplace-delivery');
        await capture(page, '/agents/mcp-tools', 'doc-55-mcp-tools');
    });

    test('agents', async ({ page }) => {
        await capture(page, '/agents', 'doc-15-agents', text('Code Reviewer'));
        const agents = await api<Agent[]>(page, '/api/agents');
        const reviewer = agents.find((a) => a.name === 'Code Reviewer') ?? agents[0];
        expect(reviewer, 'no agents installed — run populate-guide.ts').toBeTruthy();
        const coder = agents.find((a) => a.name === 'Coder') ?? reviewer;
        // Safe: asserted truthy just above.
        const r = reviewer!;
        await capture(page, `/agents/${coder!.id}?tab=overview`, 'doc-16-agent-overview');
        await capture(page, `/agents/${coder!.id}?tab=prompt`, 'doc-17-agent-prompt');
        await capture(page, `/agents/${r.id}?tab=tests`, 'doc-18-agent-tests');
        await capture(page, `/agents/${coder!.id}?tab=performance`, 'doc-19-agent-performance');
        await capture(page, `/agents/${coder!.id}?tab=runs`, 'doc-20-agent-runs');
        await capture(page, '/agents/performance?days=30', 'doc-22-fleet-performance');
        const runs = await api<Array<{ id: string; agent_id: string }>>(page, `/api/run?agent_id=${coder!.id}`);
        if (runs[0]) await capture(page, `/agents/${coder!.id}/runs/${runs[0].id}`, 'doc-21-agent-run');
    });

    test('workflows', async ({ page }) => {
        await capture(page, '/workflows', 'doc-23-workflows', text(/quick change/i));
        const wfs = await api<Wf[]>(page, '/api/workflows');
        const delivery = wfs.find((w) => /delivery/i.test(w.name));
        const quick = wfs.find((w) => /quick/i.test(w.name));
        expect(delivery && quick, 'workflows missing — run populate-guide.ts').toBeTruthy();
        await capture(page, `/workflows/${delivery!.id}?tab=builder`, 'doc-24-workflow-builder', text('PO Writer'));
        await capture(page, `/workflows/${quick!.id}?tab=runs`, 'doc-25-workflow-runs');
        await capture(page, `/workflows/${quick!.id}?tab=evals`, 'doc-26-workflow-evals');
        const runs = await api<Run[]>(page, '/api/items/ACM-1/workflow-runs');
        expect(runs[0], 'ACM-1 has no run').toBeTruthy();
        await capture(page, `/workflows/${runs[0]!.workflow_id}/runs/${runs[0]!.id}`, 'doc-27-workflow-run');
    });

    test('tasks', async ({ page }) => {
        await open(page, '/tasks/new', 'doc-28-task-new');
        await page.getByPlaceholder(/refund automation/i).fill('Add a dark theme to notes-web');
        await page
            .getByPlaceholder(/refunds today/i)
            .fill('notes-web is light-only. Follow the OS setting via prefers-color-scheme; no toggle needed yet.');
        await shoot(page, 'doc-28-task-new');
        await capture(page, '/tasks', 'doc-29-tasks', text('Filter notes by tag'));
        await page.locator('button[value="kanban"]').click();
        await settle(page);
        await shoot(page, 'doc-30-tasks-kanban');
        await page.locator('button[value="table"]').click();
        await capture(page, '/tasks/ACM-1', 'doc-31-task-detail', text('Filter notes by tag'));
        await capture(page, '/tasks/ACM-3', 'doc-32-task-waiting', text('Show the note count'));
    });

    // Real Claude sessions, driven the way the Owner drives one. Not via the
    // API's `initial_prompt`: in a fresh worktree Claude first asks whether to
    // trust the folder (defaulting to "No, exit"), the auto-typed prompt lands
    // on that dialog, and the session ends with no transcript. So: open it,
    // pick "Yes, I trust this folder", then ask.
    async function drive(page: Page, id: string, name: string, prompt: string): Promise<void> {
        await open(page, `/terminal/${id}`, name);
        const xterm = page.locator('.xterm').first();
        await expect(xterm).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(8_000);
        await xterm.click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(5_000);
        await page.keyboard.type(prompt);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(75_000);
    }

    async function stop(page: Page, id: string): Promise<void> {
        await page.request.post(`${API}/api/cli/sessions/${id}/stop`, {
            data: { files_to_stage: [], open_pull_request: false },
        });
    }

    test('terminal sessions (real)', async ({ page }) => {
        test.setTimeout(400_000);
        // Each capture run makes its own sessions; drop earlier runs' so the
        // Terminal and Standalone pages show one set, not a pile of copies.
        const prior = await api<Array<{ id: string }>>(page, '/api/cli/sessions');
        for (const s of prior) await page.request.delete(`${API}/api/cli/sessions/${s.id}`);
        const res = await page.request.post(`${API}/api/cli/sessions`, {
            data: { project_id: PROJECT, repo_id: 'acme-notes-web', title: 'Explore notes-web', cli: 'claude' },
        });
        expect(res.status(), await res.text()).toBeLessThan(300);
        const { id } = (await res.json()) as { id: string };
        await drive(
            page,
            id,
            'doc-34-terminal-session',
            'In three short bullets: what does this repo do, and how is it tested? Do not change any files.',
        );
        await shoot(page, 'doc-34-terminal-session');
        // The multi-pane layout with the live session connected in a pane.
        await open(page, '/terminal/layout', 'doc-35-terminal-layout');
        await page.getByRole('button', { name: /connect/i }).first().click();
        await page.getByRole('menuitem', { name: /explore notes-web/i }).first().click();
        await page.waitForTimeout(4_000);
        await shoot(page, 'doc-35-terminal-layout');
        await stop(page, id);
        await capture(page, `/terminal/${id}/history`, 'doc-36-terminal-history');

        const folder = '/tmp/atlas-guide/scratch/release-notes';
        const sa = await page.request.post(`${API}/api/cli/sessions/standalone`, {
            data: { folder_path: folder, title: 'Release notes', cli: 'claude' },
        });
        expect(sa.status(), await sa.text()).toBeLessThan(300);
        const standalone = (await sa.json()) as { id: string };
        await drive(page, standalone.id, 'doc-37-terminal-standalone', 'Summarise CHANGELOG.md in one sentence. Do not change any files.');
        await stop(page, standalone.id);
    });

    test('terminals', async ({ page }) => {
        await capture(page, '/terminal', 'doc-33-terminal');
        await capture(page, '/terminal/standalone', 'doc-37-terminal-standalone');
    });

    test('queue, search, analytics', async ({ page }) => {
        await capture(page, '/queue', 'doc-40-queue');
        await capture(page, '/search?q=notes', 'doc-41-search', text('Filter notes by tag'));
        await page.getByRole('button', { name: /^query$/i }).first().click();
        const jql = page.getByPlaceholder(/type = "task"/i);
        await jql.fill('status = "Done"');
        await jql.press('Enter');
        // Escape leaves the autocomplete open; clicking away closes it.
        await page.getByRole('heading', { name: 'Search' }).first().click();
        await settle(page);
        await shoot(page, 'doc-42-search-query');
        await capture(page, '/analytics', 'doc-43-analytics');
        await capture(page, `/analytics/project/${PROJECT}`, 'doc-44-analytics-project');
    });

    test('reminders, scratch pad, notifications, guard-rails', async ({ page }) => {
        await capture(page, '/reminders', 'doc-45-reminders', text('Review open pull requests'));
        await capture(page, '/scratch-pad', 'doc-46-scratch-pad', text('Release checklist'));
        await capture(page, '/notifications?tab=in-app', 'doc-47-notifications');
        await capture(page, '/guardrails', 'doc-48-guardrails', text(/env files/i));
    });

    test('shortcuts and 404', async ({ page }) => {
        await open(page, '/', 'doc-56-shortcuts');
        await page.keyboard.press('?');
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-56-shortcuts', 'window');
        await capture(page, '/no-such-page', 'doc-57-not-found', text(/page not found/i));
    });

    test('agents in dark mode', async ({ page }) => {
        await setThemeMode(page, 'dark');
        await capture(page, '/agents', 'doc-58-agents-dark', text('Code Reviewer'));
    });

    // LAST, and it must stay last — see the header.
    test('onboarding', async ({ page }) => {
        await page.request.post(`${API}/api/settings/test/clear-onboarding`);
        await goto(page, '/onboarding');
        await expect(page.getByText(/welcome to atlas/i).first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-01-onboarding', 'window');
        await page.getByLabel(/display name/i).fill('Alex Rivera');
        await page.getByRole('button', { name: /next/i }).click();
        await expect(page.getByText(/step 2 of 2/i).first()).toBeVisible();
        await settle(page);
        await shoot(page, 'doc-02-onboarding-workspace', 'window');
    });
});
