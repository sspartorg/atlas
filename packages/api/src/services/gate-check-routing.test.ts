import { describe, it, expect } from 'vitest';
import type { IRunOutcome } from '@atlas/shared';

import { decideCheckCommand } from './gate-check-routing.js';

/** The block a well-behaved checker emits. */
function outcome(over: Partial<IRunOutcome> = {}): IRunOutcome {
    return { kind: 'done', applies: true, command: 'pnpm test', summary: 'declared', ...over };
}

describe('decideCheckCommand', () => {
    it('runs the command the checker named', () => {
        expect(decideCheckCommand(outcome())).toEqual({ kind: 'run', command: 'pnpm test' });
    });

    it('skips, with the reason, when the concern does not apply here', () => {
        const d = decideCheckCommand(outcome({ applies: false, command: undefined, summary: 'no UI in this repo' }));
        expect(d).toEqual({ kind: 'skip', why: 'no UI in this repo' });
    });

    // The three shapes below are the whole point of the file: each is a way to
    // reach a pass edge without evidence, and none of them may.
    it('parks when the checker reported nothing at all', () => {
        expect(decideCheckCommand(null).kind).toBe('park');
    });

    it('parks when the checker never said whether the check applies', () => {
        const d = decideCheckCommand({ kind: 'done', command: 'pnpm test' });
        expect(d.kind).toBe('park');
    });

    it('parks when the check applies but no command proves it', () => {
        const d = decideCheckCommand(outcome({ command: undefined }));
        expect(d).toEqual({
            kind: 'park',
            why: 'the checker said the check applies but named no command to prove it',
        });
    });

    it('parks with the checker question when it asked one', () => {
        const d = decideCheckCommand({ kind: 'asked_question', reason: 'two repos, two stacks' });
        expect(d).toEqual({ kind: 'park', why: 'two repos, two stacks' });
    });

    it('parks when the checker rejected the task', () => {
        expect(decideCheckCommand({ kind: 'rejected' }).kind).toBe('park');
    });

    it('trims a command that arrived with padding', () => {
        expect(decideCheckCommand(outcome({ command: '  pnpm test  ' }))).toEqual({
            kind: 'run',
            command: 'pnpm test',
        });
    });

    it('parks on a command that is only whitespace', () => {
        expect(decideCheckCommand(outcome({ command: '   ' })).kind).toBe('park');
    });
});
