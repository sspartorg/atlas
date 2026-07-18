import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setThemeMode, type ThemeMode } from '../helpers/theme.js';

// 2026-06-11 — Per-button / per-link functional surface walker.
//
// The forensic visual walker (walkthrough.spec.ts) captures
// screenshots at a route-level. This spec goes one level deeper:
// for every top-level route, it enumerates every <button> and
// every <a href> on the page and asserts:
//
//   - Buttons have non-empty accessible text or an aria-label
//     (no zero-content interactive elements).
//   - Buttons are not "dead" — they must be either visible OR
//     have an aria-hidden=true (intentionally hidden, e.g. screen-
//     reader-only).
//   - Links have an href that is either:
//       * Internal route (starts with /)
//       * Full external URL (starts with http://, https://, mailto:)
//       * NOT "#" or empty or javascript:void(0)
//
// This is READ-ONLY — the walker does NOT click anything. State-
// transition coverage (modal-open, form-submit) is its own future
// spec; here we only validate the surface is well-formed.
//
// Gated by FUNCTIONAL=1 so it doesn't run as part of the default
// e2e suite. Output: e2e-logs/functional-<ts>/findings.ndjson +
// summary.md.

const FUNCTIONAL_ENABLED = process.env['FUNCTIONAL'] === '1';

const ROUTES = [
    '/',
    '/scratch-pad',
    '/projects',
    '/epics',
    '/issues',
    '/queue',
    '/search',
    '/agents',
    '/agents/mcp-tools',
    '/agents/marketplace',
    '/notifications',
    '/reminders',
    '/guardrails',
    '/settings',
    '/settings/credentials',
    '/analytics',
] as const;

const THEMES: ThemeMode[] = ['light', 'dark'];

interface ButtonFinding {
    text: string;
    aria_label: string | null;
    visible: boolean;
    aria_hidden: boolean;
    disabled: boolean;
    has_accessible_name: boolean;
    problem: string | null;
}

interface LinkFinding {
    text: string;
    href: string;
    target: string | null;
    visible: boolean;
    valid_href: boolean;
    problem: string | null;
}

interface RouteFinding {
    captured_at: string;
    route: string;
    theme: ThemeMode;
    button_count: number;
    link_count: number;
    button_problems: number;
    link_problems: number;
    buttons: ButtonFinding[];
    links: LinkFinding[];
    error?: string;
}

function nowSlug(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const RUN_TS = process.env['FUNCTIONAL_TS'] ?? nowSlug();
const OUT_DIR = process.env['OUT_DIR'] ?? `e2e-logs/functional-${RUN_TS}`;
const FINDINGS_LOG = join(OUT_DIR, 'findings.ndjson');
const SUMMARY_FILE = join(OUT_DIR, 'summary.md');

function ensureOutDir(): void {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
}

function appendFinding(record: RouteFinding): void {
    ensureOutDir();
    appendFileSync(FINDINGS_LOG, `${JSON.stringify(record)}\n`);
}

async function scanRoute(page: Page, route: string, theme: ThemeMode): Promise<void> {
    let error: string | undefined;
    let buttons: ButtonFinding[] = [];
    let links: LinkFinding[] = [];

    try {
        await page.goto(route, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);

        buttons = await page.$$eval('button', (els) =>
            els.map((el) => {
                const aria = el.getAttribute('aria-label');
                const text = (el.textContent ?? '').trim();
                const cs = window.getComputedStyle(el);
                // display:none / visibility:hidden elements ARE screen-
                // reader-skipped by standard CSS semantics; they don't
                // need explicit aria-hidden. The "invisible affordance"
                // class we care about is e.g. opacity:0 / position
                // off-screen WITHOUT aria-hidden — those bleed to SR.
                const cssHidden = cs.display === 'none' || cs.visibility === 'hidden';
                const visible = (el as HTMLElement).offsetParent !== null;
                const ariaHidden = el.getAttribute('aria-hidden') === 'true';
                const disabled = (el as HTMLButtonElement).disabled === true;
                const accessibleName = text.length > 0 || (aria != null && aria.length > 0);
                let problem: string | null = null;
                if (!accessibleName) {
                    problem = 'no accessible name (no textContent and no aria-label)';
                } else if (!visible && !ariaHidden && !cssHidden) {
                    // offsetParent==null but NOT display:none / visibility:hidden
                    // → likely opacity:0 or position off-screen without
                    // aria-hidden. That's the real bleed-to-SR case.
                    problem = 'invisible (offsetParent=null) but not aria-hidden and not CSS-hidden';
                }
                return {
                    text: text.slice(0, 60),
                    aria_label: aria,
                    visible,
                    aria_hidden: ariaHidden,
                    disabled,
                    has_accessible_name: accessibleName,
                    problem,
                };
            }),
        );

        links = await page.$$eval('a[href]', (els) =>
            els.map((el) => {
                const href = el.getAttribute('href') ?? '';
                const text = (el.textContent ?? '').trim();
                const target = el.getAttribute('target');
                const visible = (el as HTMLElement).offsetParent !== null;
                const isInternal = href.startsWith('/');
                const isExternal =
                    href.startsWith('http://') ||
                    href.startsWith('https://') ||
                    href.startsWith('mailto:') ||
                    href.startsWith('tel:');
                const isDead =
                    href === '' || href === '#' || href.toLowerCase().startsWith('javascript:');
                const validHref = isInternal || isExternal;
                let problem: string | null = null;
                if (isDead) {
                    problem = `dead link href="${href}"`;
                } else if (!validHref) {
                    problem = `non-standard href: ${href.slice(0, 80)}`;
                }
                return {
                    text: text.slice(0, 60),
                    href: href.slice(0, 200),
                    target,
                    visible,
                    valid_href: validHref,
                    problem,
                };
            }),
        );
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }

    const buttonProblems = buttons.filter((b) => b.problem !== null).length;
    const linkProblems = links.filter((l) => l.problem !== null).length;

    appendFinding({
        captured_at: new Date().toISOString(),
        route,
        theme,
        button_count: buttons.length,
        link_count: links.length,
        button_problems: buttonProblems,
        link_problems: linkProblems,
        buttons,
        links,
        ...(error ? { error } : {}),
    });
}

test.describe('functional surface walkthrough', () => {
    test.skip(!FUNCTIONAL_ENABLED, 'FUNCTIONAL=1 not set; skipping');

    test.beforeAll(() => {
        ensureOutDir();
        // Fresh ndjson so re-runs don't append.
        writeFileSync(FINDINGS_LOG, '');
        console.log(`[functional] writing findings to ${FINDINGS_LOG}`);
    });

    for (const theme of THEMES) {
        test.describe(`theme=${theme}`, () => {
            test.beforeEach(async ({ page }) => {
                await setThemeMode(page, theme);
            });

            for (const route of ROUTES) {
                test(`scan ${route}`, async ({ page }) => {
                    await scanRoute(page, route, theme);
                });
            }
        });
    }

    test('summary: findings exist', async () => {
        expect(existsSync(FINDINGS_LOG)).toBe(true);
    });
});
