import { describe, expect, it } from 'vitest';
import { combineCi, decideCiAction, type CiActionInput } from './ci-routing.js';

describe('combineCi', () => {
    const done = (name: string, conclusion: string, title?: string) => ({
        name,
        status: 'completed',
        conclusion,
        output: title ? { title } : null,
    });

    it('is null when the commit has no checks and no statuses — no CI is not green', () => {
        expect(combineCi([], [])).toEqual({ state: null, failing: [] });
    });

    it('all success / neutral / skipped is success', () => {
        expect(combineCi([done('a', 'success'), done('b', 'neutral'), done('c', 'skipped')], [{ state: 'success' }]).state).toBe(
            'success',
        );
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required'])('%s is a failure, named with its title', (c) => {
        expect(combineCi([done('lint', c, 'Lint found 3 errors'), done('ok', 'success')], [])).toEqual({
            state: 'failure',
            failing: [{ name: 'lint', detail: 'Lint found 3 errors' }],
        });
    });

    it('falls back to the output summary, then to no detail', () => {
        expect(
            combineCi(
                [
                    { name: 'a', status: 'completed', conclusion: 'failure', output: { title: ' ', summary: 'sum' } },
                    { status: 'completed', conclusion: 'failure' },
                ],
                [],
            ).failing,
        ).toEqual([
            { name: 'a', detail: 'sum' },
            { name: 'check', detail: null },
        ]);
    });

    it('anything not completed is pending', () => {
        expect(combineCi([{ name: 'a', status: 'queued' }, done('b', 'success')], []).state).toBe('pending');
        expect(combineCi([{ name: 'a', status: 'in_progress' }], []).state).toBe('pending');
    });

    it('a failure wins over pending', () => {
        expect(combineCi([{ name: 'a', status: 'in_progress' }, done('b', 'failure')], []).state).toBe('failure');
    });

    it('reads legacy statuses: failure/error fail, pending waits', () => {
        expect(combineCi([], [{ context: 'ci/jenkins', state: 'error', description: 'boom' }, { state: 'failure' }])).toEqual({
            state: 'failure',
            failing: [
                { name: 'ci/jenkins', detail: 'boom' },
                { name: 'status', detail: null },
            ],
        });
        expect(combineCi([], [{ context: 'x', state: 'pending' }]).state).toBe('pending');
    });

    it('truncates long details', () => {
        const got = combineCi([done('a', 'failure', 'x'.repeat(500))], []);
        expect(got.failing[0]?.detail).toHaveLength(200);
    });
});

describe('decideCiAction', () => {
    const base: CiActionInput = {
        itemType: 'task',
        itemStatus: 'in_review',
        ciState: 'failure',
        headSha: 'abc',
        handledSha: null,
        attempts: 0,
        liveRun: false,
        lastWorkflowId: 'wf',
        hasSubtasksStep: true,
    };

    it('continues from the Sub-tasks step when the workflow has one', () => {
        expect(decideCiAction(base)).toEqual({ kind: 'fix_subtask', workflowId: 'wf' });
    });

    it('restarts the workflow when it has no Sub-tasks step', () => {
        expect(decideCiAction({ ...base, hasSubtasksStep: false })).toEqual({ kind: 'restart', workflowId: 'wf' });
    });

    it.each<[string, Partial<CiActionInput>]>([
        ['a sub-task', { itemType: 'sub_task' }],
        ['a Task not in review', { itemStatus: 'in_progress' }],
        ['green CI', { ciState: 'success' }],
        ['pending CI', { ciState: 'pending' }],
        ['no CI', { ciState: null }],
        ['no head sha', { headSha: null }],
        ['a sha already handled', { handledSha: 'abc' }],
    ])('does nothing for %s', (_label, patch) => {
        expect(decideCiAction({ ...base, ...patch })).toEqual({ kind: 'none' });
    });

    it('a new sha after a handled one is judged again', () => {
        expect(decideCiAction({ ...base, handledSha: 'old' }).kind).toBe('fix_subtask');
    });

    it('only notifies while a run is live, past the cap, or with nothing to continue', () => {
        expect(decideCiAction({ ...base, liveRun: true })).toMatchObject({ kind: 'notify', why: expect.stringContaining('already working') });
        expect(decideCiAction({ ...base, attempts: 2 })).toMatchObject({ kind: 'notify', why: expect.stringContaining('2 automatic fixes') });
        expect(decideCiAction({ ...base, lastWorkflowId: null })).toMatchObject({ kind: 'notify', why: expect.stringContaining('no completed') });
    });

    it('still fixes on the second attempt', () => {
        expect(decideCiAction({ ...base, attempts: 1 }).kind).toBe('fix_subtask');
    });
});
