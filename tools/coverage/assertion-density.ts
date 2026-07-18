#!/usr/bin/env node
// Theme 12 — assertion-density check.
//
// Walks every `*.test.{ts,tsx}` in `packages/` and counts:
//   - it()/test() blocks
//   - expect(...) calls
//
// Tests whose `expects / its` ratio is < `MIN_DENSITY` are flagged.
// Tests with 0 `it()` blocks are skipped (probably top-level describes
// that just import).
//
// Informational by default — exits 0 even with low-density files,
// printing a report. Set `STRICT=1` to exit non-zero when any file
// is below the floor (CI gate posture).
//
// The point: a coverage gate alone produces "coverage by import" —
// tests that load a module but don't assert behavior. This script is
// the second line of defense.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const MIN_DENSITY = 0.8;
const STRICT = process.env['STRICT'] === '1';

interface FileReport {
    file: string;
    its: number;
    expects: number;
    density: number;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
        const path = resolve(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path, out);
        else if (
            (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) &&
            extname(entry).startsWith('.t')
        ) {
            out.push(path);
        }
    }
    return out;
}

function countMatches(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}

const packagesRoot = resolve(process.cwd(), 'packages');
const testFiles = walk(packagesRoot);

const reports: FileReport[] = [];
for (const file of testFiles) {
    const text = readFileSync(file, 'utf8');
    const its = countMatches(text, /(?<![A-Za-z0-9_])(?:it|test)\s*\(/g);
    const expects = countMatches(text, /(?<![A-Za-z0-9_])expect\s*\(/g);
    if (its === 0) continue;
    const density = expects / its;
    reports.push({
        file: file.replace(`${process.cwd()}\\`, '').replace(`${process.cwd()}/`, ''),
        its,
        expects,
        density,
    });
}

reports.sort((a, b) => a.density - b.density);

const lowDensity = reports.filter((r) => r.density < MIN_DENSITY);

if (lowDensity.length === 0) {
    process.stdout.write(
        `[assertion-density] OK — ${reports.length} test files, all ≥ ${MIN_DENSITY} expects/it\n`,
    );
} else {
    process.stdout.write(
        `[assertion-density] ${lowDensity.length} file(s) below floor (${MIN_DENSITY} expects/it):\n`,
    );
    for (const r of lowDensity) {
        process.stdout.write(
            `  ${r.file} — ${r.expects} expects / ${r.its} its (density ${r.density.toFixed(2)})\n`,
        );
    }
}

if (STRICT && lowDensity.length > 0) {
    process.exit(1);
}
