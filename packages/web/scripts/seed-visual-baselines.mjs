#!/usr/bin/env node
// Seed visual baselines against the running dev stack (web :4000).
// Uses the desktop / mobile / ipad viewports declared in playwright.config.ts
// and writes PNGs matching the naming convention expected by
// e2e/visual/snapshots.spec.ts.
//
// Run from repo root:
//   node packages/web/scripts/seed-visual-baselines.mjs
//
// Requires Playwright to be installed via `pnpm exec playwright install chromium`.
// Skips the DETAIL_ROUTES that require the e2e-terminal-project fixture.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'e2e', 'visual', '__snapshots__', 'snapshots.spec.ts');

const TOP_LEVEL_ROUTES = [
    '/',
    '/projects',
    '/epics',
    '/issues',
    '/agents',
    '/agents/marketplace',
    '/agents/mcp-tools',
    '/queue',
    '/search',
    '/notifications',
    '/reminders',
    '/settings',
    '/settings/credentials',
    '/guardrails',
    '/analytics',
    '/terminal',
    '/terminal/layout',
    '/scratch-pad',
];

const THEMES = ['light', 'dark'];

// Viewports mirror playwright.config.ts's chromium / mobile-chrome / ipad-chrome.
// Naming: desktop chromium PNGs have NO project suffix (fallback baseline).
// Mobile & iPad get the project suffix per Playwright convention.
const VIEWPORTS = [
    { name: 'chromium', width: 1920, height: 1080, suffix: '' },
    { name: 'mobile-chrome', width: 390, height: 844, suffix: '-mobile-chrome' },
    { name: 'ipad-chrome', width: 834, height: 1194, suffix: '-ipad-chrome' },
];

function safeName(route) {
    return route.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

async function seedOne(page, route, theme, viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((t) => localStorage.setItem('atlas.theme', t), theme);
    await page.goto('http://localhost:4000' + route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const filename = `${theme}--${safeName(route)}${viewport.suffix}.png`;
    const target = path.join(OUT_DIR, filename);
    await page.screenshot({ path: target, fullPage: true });
    return filename;
}

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    let total = 0;
    let failed = 0;
    try {
        for (const viewport of VIEWPORTS) {
            for (const theme of THEMES) {
                const context = await browser.newContext({
                    viewport: { width: viewport.width, height: viewport.height },
                    deviceScaleFactor: 1,
                });
                const page = await context.newPage();
                for (const route of TOP_LEVEL_ROUTES) {
                    try {
                        const fn = await seedOne(page, route, theme, viewport);
                        total += 1;
                        console.log(`ok  ${fn}`);
                    } catch (e) {
                        failed += 1;
                        console.log(`ERR ${theme}--${safeName(route)}${viewport.suffix}.png — ${e.message}`);
                    }
                }
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
    console.log(`\n${total} baselines written, ${failed} failed`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
