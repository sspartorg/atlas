// Reviewer agents must ship a required checklist.
//
// `agent-runner-outcome-routing.ts:72-74` treats an empty required checklist
// as an automatic pass:
//
//     if (input.requiredChecklist.length === 0) return { kind: 'apply_on_pass' }
//
// Every reviewer shipped `checklists.json: []` until 2026-09-20, so a reviewer
// that signalled `done` always took the on-pass edge no matter what it had
// actually verified. The Delivery workflow opened PRs with red test suites and
// every reviewer reported green (campaign finding F-012).
//
// This is a catalog-shape test, not a behaviour test: it asserts the gate
// exists. Whether an agent reports a row honestly is a separate concern —
// checklist results are self-reported in the `atlas-outcome` block and are not
// machine-verified.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(__dirname, 'catalog');

interface ChecklistRow {
    label: string;
    sort_order: number;
    required: boolean;
}

function reviewerIds(): string[] {
    return readdirSync(CATALOG, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.endsWith('-reviewer'))
        .map((e) => e.name)
        .sort();
}

function checklist(id: string): ChecklistRow[] {
    return JSON.parse(readFileSync(join(CATALOG, id, 'checklists.json'), 'utf8')) as ChecklistRow[];
}

describe('catalog — reviewer checklists', () => {
    const ids = reviewerIds();

    it('finds the reviewer agents', () => {
        // Guards against the glob silently matching nothing if the naming
        // convention changes — an empty list would make every case below vacuous.
        expect(ids.length).toBeGreaterThanOrEqual(5);
    });

    for (const id of ids) {
        it(`${id} ships at least one required checklist row`, () => {
            const rows = checklist(id);
            const required = rows.filter((r) => r.required);
            if (required.length === 0) {
                throw new Error(
                    `${id}/checklists.json has no required rows — its \`done\` would auto-pass ` +
                        `(agent-runner-outcome-routing.ts:72). See campaign finding F-012.`,
                );
            }
            expect(required.length).toBeGreaterThan(0);
        });

        it(`${id} checklist rows are well-formed`, () => {
            const rows = checklist(id);
            const orders = rows.map((r) => r.sort_order);
            expect(new Set(orders).size).toBe(rows.length);
            for (const r of rows) {
                expect(typeof r.label).toBe('string');
                expect(r.label.trim().length).toBeGreaterThan(0);
                expect(typeof r.required).toBe('boolean');
            }
        });
    }

    it('the code reviewer gates on the full test suite', () => {
        // Its own prompt.md:34 says "You are the only step that runs the full
        // test suite, so never skip `test` when it is declared." That claim
        // needs a checklist row behind it or nothing routes on it.
        const labels = checklist('agent-code-reviewer')
            .filter((r) => r.required)
            .map((r) => r.label.toLowerCase());
        expect(labels.some((l) => l.includes('test suite'))).toBe(true);
    });
});
