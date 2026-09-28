import type { AgentTestExpectations } from '../../api/types.js';

/**
 * The "Checks" part of the test form (ADR 0023 amendment): what scopes an
 * agent — "never writes code, never answers who the president is" — as plain
 * text fields, one entry per line.
 */
export interface ChecksForm {
    /** Forbids the editing tools AND requires an unchanged checkout. */
    readOnly: boolean;
    replyMustMatch: string;
    replyMustNotMatch: string;
    commandsForbidden: string;
    judgeCriteria: string;
    script: string;
}

export const EMPTY_CHECKS: ChecksForm = {
    readOnly: false,
    replyMustMatch: '',
    replyMustNotMatch: '',
    commandsForbidden: '',
    judgeCriteria: '',
    script: '',
};

/** The tools a read-only agent may not call. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

const lines = (s: string): string[] =>
    s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

export function checksFrom(e: AgentTestExpectations): ChecksForm {
    return {
        readOnly: e.no_code_changes === true,
        replyMustMatch: (e.reply_must_match ?? []).join('\n'),
        replyMustNotMatch: (e.reply_must_not_match ?? []).join('\n'),
        commandsForbidden: (e.commands_forbidden ?? []).join('\n'),
        judgeCriteria: (e.judge_criteria ?? []).join('\n'),
        script: e.script?.body_sh ?? '',
    };
}

/**
 * Write the form's checks onto `base`, keeping every expectation the form does
 * not show. An emptied field removes its key rather than sending `[]`.
 */
export function applyChecks(base: AgentTestExpectations, c: ChecksForm): AgentTestExpectations {
    const out: AgentTestExpectations = { ...base };
    const set = <K extends keyof AgentTestExpectations>(key: K, value: AgentTestExpectations[K] | undefined) => {
        if (value === undefined) delete out[key];
        else out[key] = value;
    };
    const list = (s: string) => (lines(s).length > 0 ? lines(s) : undefined);
    set('reply_must_match', list(c.replyMustMatch));
    set('reply_must_not_match', list(c.replyMustNotMatch));
    set('commands_forbidden', list(c.commandsForbidden));
    set('judge_criteria', list(c.judgeCriteria));
    set('script', c.script.trim() ? { body_sh: c.script } : undefined);

    const forbidden = base.tools_forbidden ?? [];
    if (c.readOnly) {
        set('no_code_changes', true);
        set('tools_forbidden', [...new Set([...forbidden, ...WRITE_TOOLS])]);
    } else {
        set('no_code_changes', undefined);
        // Undo only what the toggle added: a reviewer test that forbade
        // `Edit` on its own keeps forbidding it.
        if (base.no_code_changes) {
            const kept = forbidden.filter((t) => !WRITE_TOOLS.includes(t));
            set('tools_forbidden', kept.length > 0 ? kept : undefined);
        }
    }
    return out;
}
