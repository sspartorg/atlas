import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The judge spawns a CLI. What is under test is how its answer is read and
// what happens when it cannot give one — not the subprocess.
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

import { judgeAgentTestRun } from './agent-tests-judge.js';

/** A fake child that emits `stdout` then closes with `code`. */
function fakeChild(stdout: string, code = 0) {
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    const child = {
        stdout: { on: (_e: string, cb: (c: Buffer) => void) => cb(Buffer.from(stdout)) },
        stderr: { on: () => undefined },
        stdin: { write: () => undefined, end: () => undefined },
        kill: () => undefined,
        on: (event: string, cb: (arg?: unknown) => void) => {
            handlers[event] = [...(handlers[event] ?? []), cb];
            if (event === 'close') queueMicrotask(() => cb(code));
        },
    };
    return child;
}

const block = (kind: string, summary: string) =>
    JSON.stringify({
        type: 'result',
        result: `\`\`\`atlas-outcome\noutcome: ${kind}\nsummary: ${summary}\n\`\`\``,
    });

const evidence = { summary: 'rejected the work', reason: 'no test covers it', trace: null };

beforeEach(() => {
    spawn.mockReset();
    process.env['ATLAS_AI_ENABLED'] = 'true';
});

afterEach(() => {
    delete process.env['ATLAS_AI_ENABLED'];
});

describe('judgeAgentTestRun', () => {
    // Off by default: no criteria, no spawn, no cost, no non-determinism.
    it('does nothing at all when the test asked for no judging', async () => {
        expect(await judgeAgentTestRun(undefined, evidence)).toBeNull();
        expect(await judgeAgentTestRun([], evidence)).toBeNull();
        expect(spawn).not.toHaveBeenCalled();
    });

    it('does nothing when AI is not enabled here', async () => {
        process.env['ATLAS_AI_ENABLED'] = 'false';
        expect(await judgeAgentTestRun(['is it clear?'], evidence)).toBeNull();
        expect(spawn).not.toHaveBeenCalled();
    });

    it('reads a pass out of the block the product already speaks', async () => {
        spawn.mockReturnValue(fakeChild(block('done', 'every criterion held')));
        expect(await judgeAgentTestRun(['is it clear?'], evidence)).toMatchObject({
            verdict: 'pass',
            reason: 'every criterion held',
        });
    });

    it('reads a fail, and keeps the reason', async () => {
        spawn.mockReturnValue(fakeChild(block('rejected', 'it never said which row failed')));
        expect(await judgeAgentTestRun(['does it say which row failed?'], evidence)).toMatchObject({
            verdict: 'fail',
            reason: 'it never said which row failed',
        });
    });

    // A judge that would not commit either way has abstained. That is a fact
    // about the judge, not a finding about the agent.
    it('treats a judge that would not commit as an abstention', async () => {
        spawn.mockReturnValue(fakeChild(block('asked_question', 'the criteria contradict each other')));
        expect(await judgeAgentTestRun(['x'], evidence)).toMatchObject({ verdict: 'abstained' });
    });

    it('abstains rather than guessing when the answer is unreadable', async () => {
        spawn.mockReturnValue(fakeChild('I think it was fine, probably.'));
        expect(await judgeAgentTestRun(['x'], evidence)).toMatchObject({
            verdict: 'abstained',
            reason: expect.stringContaining('expected form'),
        });
    });

    it('abstains when the judge could not run', async () => {
        spawn.mockReturnValue(fakeChild('', 127));
        expect(await judgeAgentTestRun(['x'], evidence)).toMatchObject({ verdict: 'abstained' });
    });

    // A spawned process that dies rather than exiting — the CLI segfaulted,
    // the binary was not executable. Still an abstention, not a finding.
    it('abstains when the process errors instead of exiting', async () => {
        const child = fakeChild('', 0);
        child.on = (event: string, cb: (arg?: unknown) => void) => {
            if (event === 'error') queueMicrotask(() => cb(new Error('EACCES')));
        };
        spawn.mockReturnValue(child);
        expect(await judgeAgentTestRun(['x'], evidence)).toMatchObject({
            verdict: 'abstained',
            reason: 'EACCES',
        });
    });

    // A judge that never answers must not hold a test run open for ever.
    it('abstains when the judge never answers', async () => {
        vi.useFakeTimers();
        try {
            const child = fakeChild('', 0);
            let killed = false;
            child.kill = () => {
                killed = true;
                return undefined;
            };
            // Neither `close` nor `error` ever fires.
            child.on = () => undefined;
            spawn.mockReturnValue(child);
            const pending = judgeAgentTestRun(['x'], evidence);
            await vi.advanceTimersByTimeAsync(121_000);
            expect(await pending).toMatchObject({ verdict: 'abstained', reason: 'the judge timed out' });
            expect(killed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('abstains when the CLI is not there at all', async () => {
        spawn.mockImplementation(() => {
            throw new Error('claude: command not found');
        });
        expect(await judgeAgentTestRun(['x'], evidence)).toMatchObject({
            verdict: 'abstained',
            reason: expect.stringContaining('command not found'),
        });
    });

    // The judge is not the agent: changing an agent's model must not change
    // its grade.
    it('always uses the same cheap model, whatever the agent runs on', async () => {
        spawn.mockReturnValue(fakeChild(block('done', 'ok')));
        await judgeAgentTestRun(['x'], evidence);
        const args = spawn.mock.calls[0]?.[1] as string[];
        expect(args).toContain('haiku');
    });

    // It sees the summary, the reason and the trace — never the repo, never
    // the diff, never the raw transcript. Same bytes in, same question out.
    it('grades deterministic evidence, not the repo', async () => {
        let prompt = '';
        const child = fakeChild(block('done', 'ok'));
        child.stdin.write = (c: string) => {
            prompt = c;
            return undefined;
        };
        spawn.mockReturnValue(child);
        await judgeAgentTestRun(['did it explain why?'], {
            summary: 'rejected the work',
            reason: 'no test covers it',
            trace: null,
        });
        expect(prompt).toContain('did it explain why?');
        expect(prompt).toContain('rejected the work');
        expect(prompt).toContain('no test covers it');
        expect(prompt).toContain('atlas-outcome');
    });

    it('attributes the judge’s own spend', async () => {
        const withCost = [
            block('done', 'ok'),
            JSON.stringify({ type: 'result', total_cost_usd: 0.004, usage: {} }),
        ].join('\n');
        spawn.mockReturnValue(fakeChild(withCost));
        const r = await judgeAgentTestRun(['x'], evidence);
        expect(r?.cost_usd).toBeTypeOf('number');
    });
});
