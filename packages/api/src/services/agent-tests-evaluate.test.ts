import { describe, expect, it } from 'vitest';
import type { IRunOutcome, IRunTraceSummary } from '@atlas/shared';

import { evaluateAgentTest, type AgentTestObservation } from './agent-tests-evaluate.js';

const obs = (over: Partial<AgentTestObservation> = {}): AgentTestObservation => ({
    outcome: { kind: 'done', summary: 'did the thing' } as IRunOutcome,
    requiredChecklist: [],
    cost_usd: 0.1,
    duration_s: 10,
    ran: true,
    ...over,
});

describe('evaluateAgentTest', () => {
    it('passes when nothing is asserted', () => {
        expect(evaluateAgentTest({}, obs())).toEqual({ verdict: 'passed', failures: [] });
    });

    describe('outcome kind', () => {
        it('passes when it matches', () => {
            expect(evaluateAgentTest({ outcome_kind: 'done' }, obs()).verdict).toBe('passed');
        });

        it('fails when it does not, naming both sides', () => {
            const r = evaluateAgentTest({ outcome_kind: 'done' }, obs({ outcome: { kind: 'rejected' } as IRunOutcome }));
            expect(r.verdict).toBe('failed');
            expect(r.failures[0]).toContain('expected outcome `done`');
            expect(r.failures[0]).toContain('got `rejected`');
        });

        // The single most important assertion this framework has to support.
        // `ambiguous-must-escalate` exists because an agent that invents a
        // feature from an unanswerable Task has FAILED and one that asks has
        // SUCCEEDED. A framework that can only assert success cannot say that.
        it('treats asked_question as a pass when that is what was expected', () => {
            const r = evaluateAgentTest(
                { outcome_kind: 'asked_question' },
                obs({ outcome: { kind: 'asked_question', reason: 'who is a team member?' } as IRunOutcome }),
            );
            expect(r).toEqual({ verdict: 'passed', failures: [] });
        });

        it('fails an agent that answered when it should have asked', () => {
            const r = evaluateAgentTest({ outcome_kind: 'asked_question' }, obs());
            expect(r.verdict).toBe('failed');
            expect(r.failures[0]).toContain('got `done`');
        });

        it('reports a missing outcome block as `none` rather than crashing', () => {
            const r = evaluateAgentTest({ outcome_kind: 'done' }, obs({ outcome: null }));
            expect(r.failures[0]).toContain('got `none`');
        });
    });

    describe('required checklist', () => {
        const checklist = [
            { id: 1, label: 'wrote the spec' },
            { id: 2, label: 'linked the twin' },
        ];

        it('passes when every required row is ticked', () => {
            const r = evaluateAgentTest(
                { required_checklist_all_passed: true },
                obs({
                    requiredChecklist: checklist,
                    outcome: {
                        kind: 'done',
                        summary: 's',
                        checklist: [
                            { id: 1, passed: true },
                            { id: 2, passed: true },
                        ],
                    } as IRunOutcome,
                }),
            );
            expect(r.verdict).toBe('passed');
        });

        it('fails, and names the row, when one is not', () => {
            const r = evaluateAgentTest(
                { required_checklist_all_passed: true },
                obs({
                    requiredChecklist: checklist,
                    outcome: {
                        kind: 'done',
                        summary: 's',
                        checklist: [{ id: 1, passed: true }],
                    } as IRunOutcome,
                }),
            );
            expect(r.verdict).toBe('failed');
            expect(r.failures[0]).toContain('linked the twin');
        });

        // An empty required checklist makes `done` an automatic pass in the
        // engine (finding F-012). A test asserting the checklist on an agent
        // that has none would pass vacuously and look like evidence.
        it('fails loudly rather than passing vacuously when the agent has no required rows', () => {
            const r = evaluateAgentTest({ required_checklist_all_passed: true }, obs({ requiredChecklist: [] }));
            expect(r.verdict).toBe('failed');
            expect(r.failures[0]).toContain('no required checklist rows');
        });

        // `decideRunRouting` returns `apply_on_fail` for a rejection AND for a
        // failed checklist. Reading the kind alone would report a phantom
        // checklist failure on a test that expected a rejection.
        it('does not report a phantom checklist failure when the agent rejected', () => {
            const r = evaluateAgentTest(
                { outcome_kind: 'rejected', required_checklist_all_passed: true },
                obs({ requiredChecklist: checklist, outcome: { kind: 'rejected', reason: 'no' } as IRunOutcome }),
            );
            expect(r).toEqual({ verdict: 'passed', failures: [] });
        });
    });

    describe('summary text', () => {
        it('matches case-insensitively', () => {
            expect(
                evaluateAgentTest({ summary_contains: ['THE THING'] }, obs()).verdict,
            ).toBe('passed');
        });

        it('fails when a required phrase is absent', () => {
            const r = evaluateAgentTest({ summary_contains: ['migration'] }, obs());
            expect(r.failures[0]).toContain('does not mention "migration"');
        });

        it('fails when a forbidden phrase is present', () => {
            const r = evaluateAgentTest({ summary_omits: ['thing'] }, obs());
            expect(r.failures[0]).toContain('mentions "thing" and should not');
        });
    });

    describe('ceilings', () => {
        it('fails a run that cost more than allowed', () => {
            const r = evaluateAgentTest({ max_cost_usd: 0.05 }, obs({ cost_usd: 0.2 }));
            expect(r.failures[0]).toContain('exceeded the $0.05 ceiling');
        });

        it('fails a run that took longer than allowed', () => {
            const r = evaluateAgentTest({ max_duration_s: 5 }, obs({ duration_s: 30 }));
            expect(r.failures[0]).toContain('over the 5s ceiling');
        });

        it('does not fail a ceiling it has no measurement for', () => {
            expect(
                evaluateAgentTest({ max_cost_usd: 0.01, max_duration_s: 1 }, obs({ cost_usd: null, duration_s: null }))
                    .verdict,
            ).toBe('passed');
        });
    });

    // A dispatch that never ran is a broken test environment, not a failing
    // agent. Calling it `failed` would blame the agent for a missing CLI
    // binary — the same distinction ADR 0020 draws for a gate that could not run.
    it('reports a dispatch that never completed as errored, not failed', () => {
        const r = evaluateAgentTest({ outcome_kind: 'done' }, obs({ ran: false, outcome: null }));
        expect(r.verdict).toBe('errored');
        expect(r.failures).toEqual(['the agent run did not complete']);
    });

    it('reports every failure, not just the first', () => {
        const r = evaluateAgentTest(
            { outcome_kind: 'rejected', summary_contains: ['nope'], max_cost_usd: 0.01 },
            obs(),
        );
        expect(r.failures).toHaveLength(3);
    });
});

// ── What it DID (migration 017) ──────────────────────────────────────────
//
// Everything above asserts on the `atlas-outcome` block the agent writes about
// itself. These assert on the record of what it actually did.

describe('trace expectations', () => {
    function trace(over: Partial<IRunTraceSummary> = {}): IRunTraceSummary {
        return {
            source: 'claude',
            turns: 10,
            tool_calls: 6,
            tools: { Read: 4, Bash: 2 },
            tool_sequence: ['Read', 'Bash'],
            thinking_blocks: 2,
            subagent_turns: 0,
            files_touched: ['src/todos.js', 'README.md'],
            errors: 0,
            ttft_ms: 2000,
            truncated: false,
            ...over,
        };
    }
    const done: IRunOutcome = { kind: 'done', summary: 'did it' };
    const observe = (t: IRunTraceSummary | null) => ({
        outcome: done,
        trace: t,
        requiredChecklist: [],
        cost_usd: 0.1,
        duration_s: 10,
        ran: true,
    });

    it('passes when the tools it required were used', () => {
        expect(evaluateAgentTest({ tools_required: ['Read'] }, observe(trace())).verdict).toBe('passed');
    });

    it('fails when a required tool was never used', () => {
        const r = evaluateAgentTest({ tools_required: ['Edit'] }, observe(trace()));
        expect(r.verdict).toBe('failed');
        expect(r.failures[0]).toContain('never used');
    });

    // `tools_forbidden: ['Edit','Write']` on a reviewer is a real assertion:
    // a reviewer that edited the code under review is not reviewing it.
    it('fails when it used a tool the test forbids', () => {
        const r = evaluateAgentTest({ tools_forbidden: ['Bash'] }, observe(trace()));
        expect(r.verdict).toBe('failed');
        expect(r.failures[0]).toContain('forbids');
    });

    it('holds it to a turn and tool-call ceiling', () => {
        expect(evaluateAgentTest({ max_turns: 5 }, observe(trace())).failures[0]).toContain('10 turns');
        expect(evaluateAgentTest({ max_tool_calls: 3 }, observe(trace())).failures[0]).toContain('6 tool calls');
        expect(evaluateAgentTest({ max_turns: 10, max_tool_calls: 6 }, observe(trace())).verdict).toBe('passed');
    });

    it('matches touched files by substring', () => {
        expect(evaluateAgentTest({ files_touched: ['todos'] }, observe(trace())).verdict).toBe('passed');
        expect(evaluateAgentTest({ files_untouched: ['README'] }, observe(trace())).failures[0]).toContain('forbids');
    });

    // The whole point. Silently passing an assertion nobody could make is the
    // hole ADR 0020 closed by separating a gate that went green from one that
    // could not run.
    it('errors rather than passing when there is no trace to check', () => {
        const r = evaluateAgentTest({ tools_required: ['Read'] }, observe(null));
        expect(r.verdict).toBe('errored');
        expect(r.failures[0]).toContain('no transcript');
    });

    // Copilot reports tool NAMES but not their arguments, so which files a run
    // touched is genuinely unknown there.
    it('errors rather than passing when this CLI cannot report files', () => {
        const r = evaluateAgentTest(
            { files_touched: ['src/'] },
            observe(trace({ source: 'copilot', files_touched: null })),
        );
        expect(r.verdict).toBe('errored');
        expect(r.failures[0]).toContain('does not report which files');
    });

    // A capped list can prove a file WAS touched; it can never prove one was
    // not, because the missing entries are exactly what it dropped.
    it('refuses to prove a negative from a truncated list', () => {
        const r = evaluateAgentTest(
            { files_untouched: ['secrets'] },
            observe(trace({ truncated: true })),
        );
        expect(r.verdict).toBe('errored');
        expect(r.failures[0]).toContain('cannot be proved');
    });

    it('still proves a positive from a truncated list', () => {
        expect(
            evaluateAgentTest({ files_touched: ['todos'] }, observe(trace({ truncated: true }))).verdict,
        ).toBe('passed');
    });

    // A test that asks nothing about behaviour must not start demanding a
    // trace that older runs do not have.
    it('ignores a missing trace when nothing asked about behaviour', () => {
        expect(evaluateAgentTest({ outcome_kind: 'done' }, observe(null)).verdict).toBe('passed');
    });
});
