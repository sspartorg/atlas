import { describe, expect, it } from 'vitest';
import { decideRunRouting } from './agent-runner-outcome-routing.js';

describe('decideRunRouting', () => {
    it('parks when no outcome block was found in the agent output', () => {
        expect(decideRunRouting({ outcome: null, requiredChecklist: [] })).toEqual({
            kind: 'park_waiting_for_info',
            detail: 'agent_did_not_signal_outcome',
        });
    });

    it('parks on asked_question with the reason in the detail', () => {
        expect(
            decideRunRouting({
                outcome: { kind: 'asked_question', reason: 'need owner to pick option A vs B' },
                requiredChecklist: [],
            }),
        ).toEqual({
            kind: 'park_waiting_for_info',
            detail: 'agent_asked_question: need owner to pick option A vs B',
        });
    });

    it('parks on asked_question even without reason', () => {
        expect(
            decideRunRouting({
                outcome: { kind: 'asked_question' },
                requiredChecklist: [],
            }),
        ).toEqual({
            kind: 'park_waiting_for_info',
            detail: 'agent_asked_question',
        });
    });

    it('routes on-fail when outcome is rejected', () => {
        expect(
            decideRunRouting({
                outcome: { kind: 'rejected', reason: 'PR diff drops public API w/o deprecation' },
                requiredChecklist: [],
            }),
        ).toEqual({
            kind: 'apply_on_fail',
            detail: 'rejected: PR diff drops public API w/o deprecation',
        });
    });

    it('routes on-pass when outcome is done and no required checklist', () => {
        expect(
            decideRunRouting({
                outcome: { kind: 'done', summary: 'merged the PR' },
                requiredChecklist: [],
            }),
        ).toEqual({ kind: 'apply_on_pass' });
    });

    it('routes on-pass when outcome is done and every required item passed', () => {
        expect(
            decideRunRouting({
                outcome: {
                    kind: 'done',
                    summary: 'shipped story MON-5',
                    checklist: [
                        { id: 1, passed: true },
                        { id: 2, passed: true },
                    ],
                },
                requiredChecklist: [
                    { id: 1, label: 'AS-a / I-want / so-that' },
                    { id: 2, label: 'tested_by twin linked' },
                ],
            }),
        ).toEqual({ kind: 'apply_on_pass' });
    });

    it('routes on-fail when outcome is done but the checklist is missing entirely', () => {
        const decision = decideRunRouting({
            outcome: { kind: 'done', summary: 'forgot the checklist' },
            requiredChecklist: [
                { id: 1, label: 'AS-a / I-want / so-that' },
                { id: 2, label: 'tested_by twin linked' },
            ],
        });
        expect(decision.kind).toBe('apply_on_fail');
        expect(decision.detail).toMatch(/^checklist_failed: /);
        expect(decision.detail).toContain('AS-a / I-want / so-that');
        expect(decision.detail).toContain('tested_by twin linked');
    });

    it('routes on-fail when outcome is done but one required item is missing from the report', () => {
        const decision = decideRunRouting({
            outcome: {
                kind: 'done',
                summary: 'reported only one of two',
                checklist: [{ id: 1, passed: true }],
            },
            requiredChecklist: [
                { id: 1, label: 'AS-a / I-want / so-that' },
                { id: 2, label: 'tested_by twin linked' },
            ],
        });
        expect(decision.kind).toBe('apply_on_fail');
        expect(decision.detail).toBe('checklist_failed: tested_by twin linked');
    });

    it('routes on-fail when outcome is done but a required item reports passed:false', () => {
        const decision = decideRunRouting({
            outcome: {
                kind: 'done',
                summary: 'almost',
                checklist: [
                    { id: 1, passed: true },
                    { id: 2, passed: false, evidence: 'no tests yet' },
                ],
            },
            requiredChecklist: [
                { id: 1, label: 'AS-a / I-want / so-that' },
                { id: 2, label: 'tested_by twin linked' },
            ],
        });
        expect(decision.kind).toBe('apply_on_fail');
        expect(decision.detail).toBe('checklist_failed: tested_by twin linked');
    });

    it('truncates very long detail strings to 200 chars', () => {
        const longReason = 'x'.repeat(500);
        const decision = decideRunRouting({
            outcome: { kind: 'rejected', reason: longReason },
            requiredChecklist: [],
        });
        // 'rejected: ' prefix (10) + truncated reason (200) = up to 210
        expect(decision.detail!.length).toBeLessThanOrEqual(210);
    });

    it('routes on-fail when rejected without a reason (else branch of reason ternary)', () => {
        const decision = decideRunRouting({
            outcome: { kind: 'rejected' },
            requiredChecklist: [],
        });
        expect(decision.kind).toBe('apply_on_fail');
        expect(decision.detail).toBe('rejected');
    });

    it('routes on-pass when done + checklist exists but all items pass (no failedLabels)', () => {
        // Covers the outcome.checklist truthy path when all items pass — failedLabels remains empty
        const decision = decideRunRouting({
            outcome: {
                kind: 'done',
                summary: 'all done',
                checklist: [
                    { id: 10, passed: true },
                    { id: 20, passed: true },
                ],
            },
            requiredChecklist: [
                { id: 10, label: 'must pass A' },
                { id: 20, label: 'must pass B' },
            ],
        });
        expect(decision.kind).toBe('apply_on_pass');
    });
});
