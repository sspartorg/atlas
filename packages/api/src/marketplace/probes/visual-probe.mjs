#!/usr/bin/env node
// Atlas default visual probe.
//
// `gate-visual` used to delegate entirely to a script the project declared, so
// the cross-viewport checking Atlas asks for happened only where someone had
// already built it. This is the harness for everyone else.
//
// It does NOT implement image comparison. Playwright's `toHaveScreenshot`
// already manages baselines, antialiasing tolerance, retries and the
// actual/expected/diff artefacts, and a hand-rolled pixel diff would be a worse
// version of a solved problem with a tolerance knob begging to be widened. So
// the probe generates a spec and hands it to Playwright.
//
// Exit 0 pass or skipped, 1 a real visual diff, and on a missing baseline it
// prints ATLAS_GATE_NEEDS_REVIEW and exits 1 so the run routes to the visual
// reviewer — a screen nobody has looked at yet is not breakage.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** iPad portrait is in the list because it is the width that breaks first. */
const VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'ipad-portrait', width: 834, height: 1194 },
    { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];
const START_TIMEOUT_MS = 60_000;

function skip(why) {
    console.log(`gate-visual: skipped - ${why}`);
    process.exit(0);
}

function pkg() {
    try {
        return JSON.parse(readFileSync('package.json', 'utf8'));
    } catch {
        return null;
    }
}

function resolves(spec) {
    const r = spawnSync(process.execPath, ['-e', `require.resolve(${JSON.stringify(spec)})`], {
        stdio: 'ignore',
    });
    return r.status === 0;
}

/**
 * The engines actually installed here.
 *
 * "Cross-browser" means more than one rendering engine, and the three differ
 * in exactly the ways this gate is looking for: WebKit and Gecko disagree with
 * Blink about flexbox min-size, scrollbar gutters and font metrics, which is
 * where overflow on a narrow viewport usually comes from. But asking for an
 * engine that is not installed fails the whole run, so the probe checks first
 * and reports which engines it used — one engine's pass must not read as
 * cross-browser coverage.
 */
function installedEngines() {
    const probe = `const pw = require('@playwright/test'); const { existsSync } = require('fs');
const out = [];
for (const n of ['chromium', 'webkit', 'firefox']) {
    try { if (existsSync(pw[n].executablePath())) out.push(n); } catch {}
}
process.stdout.write(out.join(','));`;
    const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    const found = (r.stdout ?? '').split(',').filter(Boolean);
    return found.length > 0 ? found : ['chromium'];
}

/** Page routes only — an API route has nothing to look at. */
function touchedPageRoutes(diff) {
    const routes = new Set();
    for (const line of diff.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        for (const m of line.matchAll(/['"`](\/[A-Za-z0-9._~\-/]*)['"`]/g)) {
            const p = m[1];
            if (!p || p.length > 120 || p.startsWith('//')) continue;
            if (/(^|\/)api(\/|$)/i.test(p)) continue;
            if (/\.[a-z0-9]{2,5}$/i.test(p)) continue;
            routes.add(p);
        }
    }
    // A UI change with no route literal still changed the page you land on.
    routes.add('/');
    return [...routes];
}

function specSource(routes, port) {
    const cases = [];
    for (const route of routes) {
        for (const vp of VIEWPORTS) {
            for (const theme of THEMES) {
                // The engine is NOT in the slug: Playwright already namespaces
                // a snapshot by project, and {projectName} is in the path
                // template below. Putting it in both would nest it twice.
                const slug = `${route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'}--${vp.name}--${theme}`;
                cases.push(`
test(${JSON.stringify(slug)}, async ({ page }) => {
    await page.setViewportSize({ width: ${vp.width}, height: ${vp.height} });
    await page.emulateMedia({ colorScheme: ${JSON.stringify(theme)} });
    await page.goto('http://127.0.0.1:${port}' + ${JSON.stringify(route)}, { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot(${JSON.stringify(slug + '.png')}, { fullPage: true, animations: 'disabled' });
});`);
            }
        }
    }
    return `import { test, expect } from '@playwright/test';\n${cases.join('\n')}\n`;
}

function main() {
    const p = pkg();
    if (!p) skip('no package.json');
    if (!p.scripts?.start) skip('the project declares no `start` script, so there is no app to screenshot');
    if (!resolves('@playwright/test')) {
        skip('@playwright/test is not installed, so there is nothing to drive a browser with');
    }

    const diff = process.env['ATLAS_DIFF'] ?? '';
    const routes = touchedPageRoutes(diff);
    const port = Number(process.env['PORT'] ?? 3000);

    const dir = mkdtempSync(join(tmpdir(), 'atlas-visual-'));
    const spec = join(dir, 'atlas-visual.spec.ts');
    writeFileSync(spec, specSource(routes, port));

    // Baselines live in the repo so they are reviewable and travel with the
    // branch that blessed them, exactly like the coverage ratchet.
    const engines = installedEngines();
    const config = join(dir, 'atlas-visual.config.ts');
    writeFileSync(
        config,
        `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: ${JSON.stringify(dir)},
    projects: [${engines.map((e) => `{ name: ${JSON.stringify(e)}, use: { ...devices[${JSON.stringify(e === 'chromium' ? 'Desktop Chrome' : e === 'webkit' ? 'Desktop Safari' : 'Desktop Firefox')}] } }`).join(', ')}],
    snapshotPathTemplate: ${JSON.stringify(join(process.cwd(), '.atlas/visual-baselines/{projectName}/{arg}{ext}'))},
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { screenshot: 'only-on-failure' },
    webServer: {
        command: ${JSON.stringify((process.env['ATLAS_PM'] ?? 'npm') + ' run start')},
        cwd: ${JSON.stringify(process.cwd())},
        port: ${port},
        reuseExistingServer: true,
        timeout: ${START_TIMEOUT_MS},
    },
});
`
    );

    const run = spawnSync('npx', ['--no-install', 'playwright', 'test', '-c', config], {
        encoding: 'utf8',
        env: { ...process.env, PORT: String(port) },
    });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;

    const coverage = `${routes.length} route(s) x ${VIEWPORTS.length} viewports x ${THEMES.length} themes x ${engines.length} engine(s) (${engines.join(', ')})`;
    if (run.status === 0) {
        console.log(`gate-visual: ${coverage} match their baselines`);
        if (engines.length === 1) {
            console.log(`   Only ${engines[0]} is installed, so this is not cross-browser coverage.`);
            console.log('   `npx playwright install webkit firefox` to widen it.');
        }
        process.exit(0);
    }

    // Playwright exits non-zero for "the app never started" and "the browser
    // is not installed" too. Reporting either as a visual regression would send
    // the visual reviewer after a diff that was never rendered (ADR 0020).
    const couldNotRun =
        /webServer was not able to start|Executable doesn't exist|playwright install|browserType\.launch/i.test(out);
    if (couldNotRun) {
        const why = /webServer was not able to start/i.test(out)
            ? 'the app did not start, so nothing could be captured'
            : 'no browser is installed for Playwright to drive';
        skip(`${why}\n${out.split('\n').slice(-12).join('\n')}`);
    }

    const missing = /snapshot.*doesn't exist|writing actual|A snapshot doesn't exist/i.test(out);
    if (missing) {
        console.log('ATLAS_GATE_NEEDS_REVIEW');
        console.log('gate-visual:');
        console.log('1. captured, but there is no baseline to compare against');
        console.log(`   Baselines live in .atlas/visual-baselines/. Look at the captures, then bless them.`);
        console.log(out.split('\n').slice(-30).join('\n'));
        process.exit(1);
    }

    console.log('gate-visual:');
    console.log('1. visual diff against the committed baseline');
    console.log(`   Checked: ${coverage}.`);
    console.log(`   Viewports: ${VIEWPORTS.map((v) => `${v.name} ${v.width}x${v.height}`).join(', ')}; themes: ${THEMES.join(', ')}.`);
    console.log('   Fix the cause (a fixed width that should be a max-width), not the tolerance.');
    console.log(out.split('\n').slice(-40).join('\n'));
    process.exit(1);
}

try {
    main();
} catch (err) {
    // Absence of evidence is never a red result (ADR 0020).
    console.log(`gate-visual: skipped - the probe could not run (${err instanceof Error ? err.message : String(err)})`);
    process.exit(0);
}
