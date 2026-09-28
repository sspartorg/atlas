import { describe, expect, it } from 'vitest';

import { applyChecks, checksFrom, EMPTY_CHECKS } from './testChecks.js';

describe('test checks', () => {
    it('round-trips every check through the form', () => {
        const e = {
            outcome_kind: 'done' as const,
            reply_must_match: ['menu'],
            reply_must_not_match: ['president', 'election'],
            commands_forbidden: ['^git push'],
            judge_criteria: ['Stays on the menu.'],
            script: { body_sh: 'exit 0' },
            no_code_changes: true,
            tools_forbidden: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
        };
        const form = checksFrom(e);
        expect(form).toEqual({
            readOnly: true,
            replyMustMatch: 'menu',
            replyMustNotMatch: 'president\nelection',
            commandsForbidden: '^git push',
            judgeCriteria: 'Stays on the menu.',
            script: 'exit 0',
        });
        expect(applyChecks(e, form)).toEqual(e);
    });

    it('drops blank lines and removes a cleared field instead of sending []', () => {
        const out = applyChecks(
            { reply_must_match: ['old'], max_cost_usd: 1 },
            { ...EMPTY_CHECKS, replyMustNotMatch: '  president \n\n' },
        );
        expect(out).toEqual({ max_cost_usd: 1, reply_must_not_match: ['president'] });
    });

    it('read-only adds the write tools once, and turning it off removes only what it added', () => {
        const on = applyChecks({ tools_forbidden: ['Bash', 'Edit'] }, { ...EMPTY_CHECKS, readOnly: true });
        expect(on.tools_forbidden).toEqual(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
        expect(on.no_code_changes).toBe(true);

        const off = applyChecks(on, EMPTY_CHECKS);
        expect(off.tools_forbidden).toEqual(['Bash']);
        expect(off).not.toHaveProperty('no_code_changes');
        expect(applyChecks({ no_code_changes: true, tools_forbidden: ['Edit'] }, EMPTY_CHECKS)).toEqual({});
    });

    it('leaves a reviewer that forbade Edit on its own alone', () => {
        expect(applyChecks({ tools_forbidden: ['Edit', 'Write'] }, EMPTY_CHECKS)).toEqual({
            tools_forbidden: ['Edit', 'Write'],
        });
    });
});
