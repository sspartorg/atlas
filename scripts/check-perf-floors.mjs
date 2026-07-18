#!/usr/bin/env node
// W7 chunk 2 — perf-baseline regression gate.
//
// Reads `e2e-logs/perf-baseline.ndjson` (produced by `pnpm e2e:perf` /
// `e2e/perf/baseline.spec.ts`) and asserts the current p95 of
// `nav_timing.load_ms` per route does NOT exceed the floor committed in
// `e2e/perf/floors.json`. Exits non-zero on any breach so CI fails the run.
//
// Why this shape:
//   - Floors are LOCKED-IN current behavior (p95 + 25% headroom). They
//     catch regressions, not absolute SLOs. The master plan's <200ms p95
//     goal needs a production-build perf run, which is W7 chunk 3 work.
//   - Routes present in the current run but ABSENT from floors.json are
//     reported as informational (new routes — promote them via floors
//     regen) but don't fail the gate.
//   - Routes present in floors.json but ABSENT from the run are flagged
//     as a coverage gap (the perf spec didn't visit them this run).

import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NDJSON_PATH = resolve(ROOT, 'e2e-logs', 'perf-baseline.ndjson');
const FLOORS_PATH = resolve(ROOT, 'e2e', 'perf', 'floors.json');

function p95(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor((sorted.length - 1) * 0.95);
    return sorted[idx];
}

function loadNdjson(path) {
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
        console.error(`perf NDJSON not found at ${path}. Run \`pnpm e2e:perf\` first.`);
        process.exit(2);
    }
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function loadFloors(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function fmt(n) {
    return `${Math.round(n)}ms`;
}

// T1 — `--strict` flag enforces the master plan's <200ms p95 TTI ceiling
// in addition to the per-route regression floor. Routes whose measured
// p95 exceeds STRICT_CEILING fail the gate even if they're under their
// historical floor. Use this with prod-mode perf runs only (dev-mode
// Vite cold-compile tails will always blow past the ceiling).
const STRICT_CEILING_MS = 200;
const STRICT_MODE = process.argv.includes('--strict');

function main() {
    const floors = loadFloors(FLOORS_PATH);
    const entries = loadNdjson(NDJSON_PATH);

    const byRoute = new Map();
    for (const e of entries) {
        const route = e.path;
        const load = e.nav_timing?.load_ms;
        if (!route || typeof load !== 'number') continue;
        if (!byRoute.has(route)) byRoute.set(route, []);
        byRoute.get(route).push(load);
    }

    const breaches = [];
    const ceilingBreaches = [];
    const newRoutes = [];
    const seenInFloors = new Set();

    for (const [route, samples] of byRoute.entries()) {
        const measuredP95 = p95(samples);

        // Strict ceiling check applies to every route, whether or not
        // it has a committed floor. Run only with `--strict` (prod mode).
        if (STRICT_MODE && measuredP95 > STRICT_CEILING_MS) {
            ceilingBreaches.push({
                route,
                samples: samples.length,
                measured: measuredP95,
                ceiling: STRICT_CEILING_MS,
                over: measuredP95 - STRICT_CEILING_MS,
            });
        }

        const floor = floors.routes[route];
        if (!floor) {
            newRoutes.push({ route, samples: samples.length, p95: measuredP95 });
            continue;
        }
        seenInFloors.add(route);
        if (measuredP95 > floor.floor_ms) {
            breaches.push({
                route,
                samples: samples.length,
                measured: measuredP95,
                floor: floor.floor_ms,
                over: measuredP95 - floor.floor_ms,
            });
        }
    }

    const missingRoutes = Object.keys(floors.routes).filter((r) => !seenInFloors.has(r));

    let exitCode = 0;

    if (ceilingBreaches.length > 0) {
        console.error(`PERF CEILING — p95 nav_timing.load_ms exceeded ${STRICT_CEILING_MS}ms:`);
        for (const c of ceilingBreaches.sort((a, b) => b.over - a.over)) {
            console.error(
                `  ${c.route.padEnd(40)} ${fmt(c.measured)} (ceiling ${fmt(c.ceiling)}, over by ${fmt(c.over)}, n=${c.samples})`,
            );
        }
        console.error('');
        console.error('The master plan locks p95 TTI at <200ms on the prod bundle.');
        console.error('Investigate the route: blocking initial fetches, missing <Suspense>,');
        console.error('missing route prefetch, React Query staleTime, code-splitting, DB plan.');
        console.error('');
        exitCode = 1;
    }

    if (breaches.length > 0) {
        console.error('PERF REGRESSION — p95 nav_timing.load_ms exceeded floor:');
        for (const b of breaches.sort((a, b) => b.over - a.over)) {
            console.error(
                `  ${b.route.padEnd(40)} ${fmt(b.measured)} (floor ${fmt(b.floor)}, over by ${fmt(b.over)}, n=${b.samples})`,
            );
        }
        console.error('');
        console.error('To accept the new baseline (after investigating the regression),');
        console.error('regenerate `e2e/perf/floors.json` from a fresh ndjson + commit it.');
        exitCode = 1;
    }

    if (exitCode !== 0) process.exit(exitCode);

    console.log(`Perf gate OK — ${seenInFloors.size} routes within p95 floors.`);
    if (STRICT_MODE) {
        console.log(`Strict ceiling OK — every route's p95 ≤ ${STRICT_CEILING_MS}ms.`);
    }
    if (newRoutes.length > 0) {
        console.log('');
        console.log(`Info: ${newRoutes.length} new routes not yet in floors.json:`);
        for (const r of newRoutes) {
            console.log(`  ${r.route.padEnd(40)} p95=${fmt(r.p95)} (n=${r.samples})`);
        }
        console.log('Add them by re-running the floor-generation step.');
    }
    if (missingRoutes.length > 0) {
        console.log('');
        console.log(`Info: ${missingRoutes.length} floor routes not exercised this run:`);
        for (const r of missingRoutes) console.log(`  ${r}`);
    }
}

main();
