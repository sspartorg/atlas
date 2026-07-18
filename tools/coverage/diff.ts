#!/usr/bin/env node
// Theme 12 — coverage delta reporter.
//
// Run after `pnpm -r test:coverage` to print a per-package markdown
// table showing total / pct numbers in one place. Pipe into a PR
// body or paste into a review thread. Reads each package's
// `coverage/coverage-summary.json` (produced by vitest's
// `json-summary` reporter).

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface CoverageSummary {
    total: {
        lines: { pct: number; covered: number; total: number };
        statements: { pct: number; covered: number; total: number };
        functions: { pct: number; covered: number; total: number };
        branches: { pct: number; covered: number; total: number };
    };
}

const PACKAGES = ['shared', 'api', 'mcp', 'web'] as const;

function readSummary(pkg: string): CoverageSummary | null {
    const path = resolve(
        process.cwd(),
        'packages',
        pkg,
        'coverage',
        'coverage-summary.json',
    );
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as CoverageSummary;
}

function fmt(n: number): string {
    return n.toFixed(2);
}

const rows: string[] = [];
rows.push('| Package | Lines | Statements | Functions | Branches |');
rows.push('|---------|------:|-----------:|----------:|---------:|');

for (const pkg of PACKAGES) {
    const summary = readSummary(pkg);
    if (!summary) {
        rows.push(`| ${pkg} | _no coverage_ | | | |`);
        continue;
    }
    const t = summary.total;
    rows.push(
        `| ${pkg} | ${fmt(t.lines.pct)} | ${fmt(t.statements.pct)} | ${fmt(t.functions.pct)} | ${fmt(t.branches.pct)} |`,
    );
}

process.stdout.write(rows.join('\n') + '\n');
