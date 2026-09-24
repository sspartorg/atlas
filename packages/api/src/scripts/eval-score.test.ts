import { describe, expect, it } from 'vitest';

import { checkExpectation, type Fixture } from './eval-score.js';

// `eval-run.ts` has declared `terminal_status`, `min_sub_tasks` and
// `requires_pr` since the harness shipped and read none of them, so "the
// fixture passed" meant a human comparing a status column to a JSON file by
// eye — the self-reported verdict ADR 0020 exists to remove, reintroduced one
// layer up in the tooling.
//
// These tests exist so a scorecard reading "12 passed" is falsifiable.
const fx = (expectBlock: Fixture['expect']): Fixture => ({ id: 'f', title: 't', expect: expectBlock });

describe('checkExpectation', () => {
    it('passes when every expectation holds', () => {
        const v = checkExpectation(
            fx({ terminal_status: ['completed'], min_sub_tasks: 2, requires_pr: true }),
            { status: 'completed', pr_urls: ['https://example/pr/1'] },
            3,
        );
        expect(v).toEqual({ fixture_id: 'f', passed: true, failures: [] });
    });

    it('fails a wrong terminal status and names both sides', () => {
        const v = checkExpectation(fx({ terminal_status: ['completed'] }), { status: 'waiting_for_owner', pr_urls: [] }, 0);
        expect(v.passed).toBe(false);
        expect(v.failures[0]).toContain('expected completed');
        expect(v.failures[0]).toContain('got waiting_for_owner');
    });

    it('fails when too few sub-tasks were created', () => {
        const v = checkExpectation(fx({ min_sub_tasks: 3 }), { status: 'completed', pr_urls: [] }, 1);
        expect(v.passed).toBe(false);
        expect(v.failures[0]).toContain('at least 3, got 1');
    });

    it('fails when a required pull request was never opened', () => {
        const v = checkExpectation(fx({ requires_pr: true }), { status: 'completed', pr_urls: [] }, 2);
        expect(v.passed).toBe(false);
        expect(v.failures[0]).toContain('none was opened');
    });

    // `ambiguous-must-escalate` exists to catch a PO Writer inventing a feature
    // from an unanswerable Task. A PR there is the failure, not the success.
    it('fails when a fixture that must NOT ship a PR shipped one', () => {
        const v = checkExpectation(
            fx({ terminal_status: ['waiting_for_owner'], requires_pr: false }),
            { status: 'waiting_for_owner', pr_urls: ['https://example/pr/9'] },
            0,
        );
        expect(v.passed).toBe(false);
        expect(v.failures[0]).toContain('requires_pr is false');
    });

    it('reports every failure, not just the first', () => {
        const v = checkExpectation(
            fx({ terminal_status: ['completed'], min_sub_tasks: 2, requires_pr: true }),
            { status: 'error', pr_urls: [] },
            0,
        );
        expect(v.failures).toHaveLength(3);
    });

    it('passes a fixture with no expect block rather than inventing a bar', () => {
        expect(checkExpectation({ id: 'f', title: 't' }, { status: 'completed', pr_urls: [] }, 0).passed).toBe(true);
    });
});
