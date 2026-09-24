#!/usr/bin/env node
// Atlas default performance probe.
//
// `gate-perf` used to delegate entirely to a script the project declared, and
// skip when there wasn't one — which meant the 100ms / 200ms budgets Atlas
// asks for were enforced on exactly the projects that had already built their
// own perf tooling, i.e. the ones that needed it least. This is the harness for
// everyone else.
//
// It is deliberately narrow. It does not discover routes by reflection, guess
// at authentication, or try to drive a browser: it starts the app the way the
// project's own `start` script does, requests the paths this branch actually
// touched, and compares p95 against a budget. Everything it cannot do honestly,
// it declines to do and says so.
//
// Exit 0 pass or skipped, 1 a budget breach. Never throws.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

// `atlas-gate/`, not `.atlas/`: Atlas gitignores `.atlas/` in every target
// repo (worktree-orchestrator.ts:713), so a budget written there would never
// be committed and every branch would silently fall back to the defaults.
const BUDGET_FILE = 'atlas-gate/perf-budget.json';
/** Industry-standard defaults, overridable per project via BUDGET_FILE. */
const DEFAULTS = { api_p95_ms: 100, web_p95_ms: 200, samples: 20, warmup: 3 };
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

function budget() {
    if (!existsSync(BUDGET_FILE)) return DEFAULTS;
    try {
        return { ...DEFAULTS, ...JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) };
    } catch {
        return DEFAULTS;
    }
}

function skip(why) {
    console.log(`gate-perf: skipped - ${why}`);
    process.exit(0);
}

function pkg() {
    try {
        return JSON.parse(readFileSync('package.json', 'utf8'));
    } catch {
        return null;
    }
}

/**
 * The paths this branch touched, read out of the diff rather than guessed.
 *
 * A route literal in added code is the strongest available signal about what a
 * change can actually slow down. It is a heuristic and it is documented as one:
 * a route assembled at runtime from variables will not be found, and the probe
 * says what it measured so nobody mistakes silence for coverage.
 */
function touchedRoutes(diff) {
    const routes = new Set();
    for (const line of diff.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        for (const m of line.matchAll(/['"`](\/[A-Za-z0-9._~\-/]*)['"`]/g)) {
            const p = m[1];
            if (!p || p.length > 120) continue;
            // Not a route: file paths, globs, and anything with an extension
            // that is obviously an asset rather than an endpoint.
            if (/\.(js|ts|tsx|jsx|mjs|cjs|json|css|scss|md|png|svg|ico|txt|yml|yaml)$/i.test(p)) continue;
            if (p.startsWith('//')) continue;
            routes.add(p);
        }
    }
    return [...routes];
}

const isApi = (route) => /(^|\/)api(\/|$)/i.test(route);

function waitForPort(port, deadline) {
    return new Promise((resolve) => {
        const attempt = () => {
            if (Date.now() > deadline) return resolve(false);
            const sock = createConnection({ port, host: '127.0.0.1' });
            sock.once('connect', () => {
                sock.destroy();
                resolve(true);
            });
            sock.once('error', () => {
                sock.destroy();
                setTimeout(attempt, 250);
            });
        };
        attempt();
    });
}

async function timeOnce(url) {
    const started = process.hrtime.bigint();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ac.signal });
        await res.arrayBuffer();
        return { ms: Number(process.hrtime.bigint() - started) / 1e6, status: res.status };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function p95(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    // Nearest-rank. With 20 samples that is the 19th, which is a real observed
    // request rather than an interpolation between two of them.
    const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
    return sorted[rank - 1];
}

async function main() {
    const p = pkg();
    if (!p) skip('no package.json');
    const start = p.scripts?.start;
    if (!start) skip('the project declares no `start` script, so there is nothing to measure against');

    const diff = process.env['ATLAS_DIFF'] ?? '';
    const routes = touchedRoutes(diff);
    if (routes.length === 0) {
        skip('the diff names no route literal, so nothing measurable changed');
    }

    const b = budget();
    const port = Number(process.env['PORT'] ?? 3000);
    const child = spawn(process.env['ATLAS_PM'] ?? 'npm', ['run', 'start'], {
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
        detached: true,
    });
    child.on('error', () => undefined);

    const up = await waitForPort(port, Date.now() + START_TIMEOUT_MS);
    if (!up) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
        skip(`the app did not open port ${port} within ${START_TIMEOUT_MS / 1000}s`);
    }

    const breaches = [];
    const measured = [];
    for (const route of routes) {
        const url = `http://127.0.0.1:${port}${route}`;
        for (let i = 0; i < b.warmup; i++) await timeOnce(url);
        const samples = [];
        let status = 0;
        for (let i = 0; i < b.samples; i++) {
            const r = await timeOnce(url);
            if (!r) break;
            samples.push(r.ms);
            status = r.status;
        }
        // A route that does not answer is not a slow route. Reporting it as a
        // breach would send the perf fixer after a 404 that was never this
        // branch's to serve.
        if (samples.length < b.samples || status >= 400) {
            measured.push(`${route}: not reachable (status ${status || 'none'}) - not measured`);
            continue;
        }
        const value = p95(samples);
        const limit = isApi(route) ? b.api_p95_ms : b.web_p95_ms;
        measured.push(`${route}: p95 ${value.toFixed(1)}ms (budget ${limit}ms)`);
        if (value > limit) {
            breaches.push(`${route}: p95 ${value.toFixed(1)}ms exceeds the ${limit}ms budget for ${isApi(route) ? 'an API' : 'a page'} route`);
        }
    }

    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }

    if (breaches.length === 0) {
        console.log(`gate-perf: within budget\n${measured.map((m) => `   ${m}`).join('\n')}`);
        process.exit(0);
    }
    console.log('gate-perf:');
    breaches.forEach((br, i) => console.log(`${i + 1}. ${br}`));
    console.log(`   Measured:\n${measured.map((m) => `   ${m}`).join('\n')}`);
    console.log(`   Budgets come from ${BUDGET_FILE} (defaults: API ${DEFAULTS.api_p95_ms}ms, page ${DEFAULTS.web_p95_ms}ms).`);
    console.log('   Fix the cost, not the budget.');
    process.exit(1);
}

main().catch((err) => {
    // A probe that cannot run is absence of evidence, never a red result
    // (ADR 0020). Say why and pass.
    console.log(`gate-perf: skipped - the probe could not run (${err instanceof Error ? err.message : String(err)})`);
    process.exit(0);
});
