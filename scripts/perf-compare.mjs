#!/usr/bin/env node
// Diff two perf harness results into a markdown table.
//   node scripts/perf-compare.mjs e2e-logs/perf/before.json e2e-logs/perf/after.json
// Lower is better for every column except mid_scroll_text (0 = blank list).
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
    console.error('usage: perf-compare.mjs <before.json> <after.json>');
    process.exit(2);
}
const load = (f) => new Map(JSON.parse(readFileSync(f, 'utf8')).results.map((r) => [r.name, r]));
const before = load(a);
const after = load(b);
const COLS = ['api_requests', 'api_kb', 'settle_ms', 'long_task_ms', 'dom_nodes', 'scroll_p95_ms', 'scroll_janky_pct', 'mid_scroll_text', 'interaction_ms'];

const cell = (x, y, col) => {
    if (x == null && y == null) return '—';
    if (x == null || y == null) return `${x ?? '—'} → ${y ?? '—'}`;
    if (x === y) return String(y);
    const better = col === 'mid_scroll_text' ? y > x : y < x;
    const pct = x === 0 ? '' : ` (${y > x ? '+' : ''}${Math.round(((y - x) / x) * 100)}%)`;
    return `${x} → **${y}**${pct} ${better ? '✅' : '⚠️'}`;
};

console.log(`| route | ${COLS.join(' | ')} |`);
console.log(`|---|${COLS.map(() => '---').join('|')}|`);
for (const name of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(name) ?? {};
    const y = after.get(name) ?? {};
    console.log(`| ${name} | ${COLS.map((c) => cell(x[c], y[c], c)).join(' | ')} |`);
}
