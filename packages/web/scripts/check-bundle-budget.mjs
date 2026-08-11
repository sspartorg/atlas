#!/usr/bin/env node
// Phase F — production bundle health gate.
//
// Reads packages/web/dist/assets/*.js after a `pnpm -F @atlas/web build`,
// computes per-chunk gzipped size, and asserts against the budget Owner
// set:
//   - Initial route chunk (entry + react-vendor + mui-*) < 260 KB gz
//   - Total app (sum of every chunk) < 830 KB gz
//   - Recharts split chunk < 130 KB gz (held over from prior baseline)
//   - mui-core split chunk < 90 KB gz
//   - mui-form split chunk < 18 KB gz
//   - mui-feedback split chunk < 22 KB gz
//   - mui-icons split chunk < 14 KB gz
//
// Exits non-zero with a per-chunk readout when any budget is exceeded.
// Wire into `pnpm gate` after `pnpm build`.
//
// Why gzip and not brotli: Cloudflare / most CDNs serve gzip by default
// when Accept-Encoding negotiates poorly; gzip is the worst-case
// transport size and the right unit for a hard floor.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = join(__dirname, '..', 'dist', 'assets');

// Owner-set budgets. Update only by ADR.
// 2026-06-28 — initial chunk raised 200 → 260 KB after a clean post-W1
// build measured 254.9 KB gz. The bulk is mui (~122 KB gz) +
// react-vendor (~61 KB gz) + index (~73 KB gz) — all of which load on
// first paint regardless of route and can't be deferred without
// breaking the React mount sequence.
// 2026-07-01 — MUI split into 4 buckets (mui-core/form/feedback/icons).
// Total budget tightened 900 → 830 KB (measured 815.6 KB, 14.4 KB slack).
// Per-chunk budgets added with ~5 KB gz headroom each.
// 2026-08-04 — initial chunk raised 260 → 264 KB (measured 260.1 KB gz).
// The third `cli` option (ollama) added ~200 bytes raw to `index`: one more
// entry per `Record<AgentCli, …>`, one more item in four pickers, and the
// shared CLI registry. 260 KB had been set with 0.1 KB of headroom, so any
// app-shell change tripped it. See docs/adr/0013-initial-chunk-budget-264kb-
// for-third-cli.md for the trimming that was tried first and kept.
const BUDGET_INITIAL_GZ = 264 * 1024;
const BUDGET_TOTAL_GZ = 830 * 1024;
const BUDGET_RECHARTS_GZ = 130 * 1024;
// Per-MUI-bucket budgets (measured 2026-07-01, +5 KB gz headroom).
const BUDGET_MUI_CORE_GZ = 90 * 1024;   // measured 85.3 KB gz
const BUDGET_MUI_FORM_GZ = 18 * 1024;   // measured 13.0 KB gz
const BUDGET_MUI_FEEDBACK_GZ = 22 * 1024; // measured 17.0 KB gz
const BUDGET_MUI_ICONS_GZ = 14 * 1024;  // measured  8.6 KB gz

// Chunks that load on first paint regardless of route. Names use the
// hashed file pattern Vite emits — match on prefix.
const INITIAL_CHUNK_PREFIXES = ['index-', 'react-vendor-', 'mui-'];

function gzippedSize(filePath) {
    return gzipSync(readFileSync(filePath), { level: 9 }).length;
}

function loadChunks() {
    if (!statSync(DIST_ASSETS, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(
            `Bundle dir not found at ${DIST_ASSETS}. Run \`pnpm -F @atlas/web build\` first.`,
        );
    }
    return readdirSync(DIST_ASSETS)
        .filter((f) => f.endsWith('.js'))
        .map((f) => {
            const filePath = join(DIST_ASSETS, f);
            return {
                name: basename(f),
                raw: statSync(filePath).size,
                gz: gzippedSize(filePath),
            };
        });
}

function fmtKb(n) {
    return `${(n / 1024).toFixed(1)} KB`;
}

function chunkBudgetCheck(breaches, chunk, budget, label) {
    if (chunk && chunk.gz > budget) {
        breaches.push(
            `${label}: ${fmtKb(chunk.gz)} gz (budget ${fmtKb(budget)}, over by ${fmtKb(chunk.gz - budget)})`,
        );
    }
}

function main() {
    const chunks = loadChunks().sort((a, b) => b.gz - a.gz);
    const totalGz = chunks.reduce((sum, c) => sum + c.gz, 0);
    const initialGz = chunks
        .filter((c) => INITIAL_CHUNK_PREFIXES.some((p) => c.name.startsWith(p)))
        .reduce((sum, c) => sum + c.gz, 0);
    const rechartsChunk = chunks.find((c) => c.name.startsWith('recharts-'));
    const muiCoreChunk = chunks.find((c) => c.name.startsWith('mui-core-'));
    const muiFormChunk = chunks.find((c) => c.name.startsWith('mui-form-'));
    const muiFeedbackChunk = chunks.find((c) => c.name.startsWith('mui-feedback-'));
    const muiIconsChunk = chunks.find((c) => c.name.startsWith('mui-icons-'));

    const breaches = [];
    if (initialGz > BUDGET_INITIAL_GZ) {
        breaches.push(
            `initial chunk: ${fmtKb(initialGz)} gz (budget ${fmtKb(BUDGET_INITIAL_GZ)}, over by ${fmtKb(initialGz - BUDGET_INITIAL_GZ)})`,
        );
    }
    if (totalGz > BUDGET_TOTAL_GZ) {
        breaches.push(
            `total app: ${fmtKb(totalGz)} gz (budget ${fmtKb(BUDGET_TOTAL_GZ)}, over by ${fmtKb(totalGz - BUDGET_TOTAL_GZ)})`,
        );
    }
    if (rechartsChunk && rechartsChunk.gz > BUDGET_RECHARTS_GZ) {
        breaches.push(
            `recharts: ${fmtKb(rechartsChunk.gz)} gz (budget ${fmtKb(BUDGET_RECHARTS_GZ)}, over by ${fmtKb(rechartsChunk.gz - BUDGET_RECHARTS_GZ)})`,
        );
    }
    chunkBudgetCheck(breaches, muiCoreChunk, BUDGET_MUI_CORE_GZ, 'mui-core');
    chunkBudgetCheck(breaches, muiFormChunk, BUDGET_MUI_FORM_GZ, 'mui-form');
    chunkBudgetCheck(breaches, muiFeedbackChunk, BUDGET_MUI_FEEDBACK_GZ, 'mui-feedback');
    chunkBudgetCheck(breaches, muiIconsChunk, BUDGET_MUI_ICONS_GZ, 'mui-icons');

    // Top 10 chunks by gz — useful when investigating a breach.
    console.log('Top 10 chunks by gz size:');
    for (const c of chunks.slice(0, 10)) {
        console.log(`  ${c.name.padEnd(50)} ${fmtKb(c.gz).padStart(10)} gz / ${fmtKb(c.raw)} raw`);
    }
    console.log('');
    console.log(`Initial chunk total: ${fmtKb(initialGz)} gz (budget ${fmtKb(BUDGET_INITIAL_GZ)})`);
    console.log(`Total app size:      ${fmtKb(totalGz)} gz (budget ${fmtKb(BUDGET_TOTAL_GZ)})`);
    if (rechartsChunk) {
        console.log(
            `Recharts chunk:      ${fmtKb(rechartsChunk.gz)} gz (budget ${fmtKb(BUDGET_RECHARTS_GZ)})`,
        );
    }
    if (muiCoreChunk) {
        console.log(`mui-core chunk:      ${fmtKb(muiCoreChunk.gz)} gz (budget ${fmtKb(BUDGET_MUI_CORE_GZ)})`);
    }
    if (muiFormChunk) {
        console.log(`mui-form chunk:      ${fmtKb(muiFormChunk.gz)} gz (budget ${fmtKb(BUDGET_MUI_FORM_GZ)})`);
    }
    if (muiFeedbackChunk) {
        console.log(`mui-feedback chunk:  ${fmtKb(muiFeedbackChunk.gz)} gz (budget ${fmtKb(BUDGET_MUI_FEEDBACK_GZ)})`);
    }
    if (muiIconsChunk) {
        console.log(`mui-icons chunk:     ${fmtKb(muiIconsChunk.gz)} gz (budget ${fmtKb(BUDGET_MUI_ICONS_GZ)})`);
    }

    if (breaches.length > 0) {
        console.error('');
        console.error('BUNDLE BUDGET EXCEEDED:');
        for (const b of breaches) console.error(`  - ${b}`);
        console.error('');
        console.error(
            'Fix by splitting large chunks (e.g. lazy-load Analytics, dynamic import MUI icons individually) or update budgets via ADR.',
        );
        process.exit(1);
    }

    console.log('');
    console.log('Bundle budget OK.');
}

main();
