import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';

// Accessibility of every Settings tab and the credentials page, in light and
// dark mode: axe (WCAG 2.1 A/AA) finds no violations.

const pages = [
    '/settings',
    '/settings?tab=environment',
    '/settings?tab=secrets',
    '/settings?tab=models',
    '/settings?tab=notifications',
    '/settings?tab=jira',
    '/settings?tab=team',
    '/settings?tab=help',
    '/settings/credentials',
];

for (const mode of ['light', 'dark'] as const) {
    test.describe(`axe · ${mode}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.addInitScript((m) => localStorage.setItem('atlas.themeMode', m), mode);
        });
        for (const path of pages) {
            test(`${path} has no WCAG A/AA violations (${mode})`, async ({ page }) => {
                await goto(page, path);
                await page.waitForTimeout(500);
                const { violations } = await new AxeBuilder({ page })
                    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                    .analyze();
                const summary = violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
                expect(summary, summary.join('\n')).toEqual([]);
            });
        }
    });
}
