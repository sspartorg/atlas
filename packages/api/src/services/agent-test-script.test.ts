import { describe, expect, it } from 'vitest';

import { runTestScript, type ScriptEvidence } from './agent-test-script.js';

const evidence: ScriptEvidence = {
    reply: 'Our Whopper is flame-grilled.',
    commands: ['ls', 'cat menu.txt'],
    tool_calls: [{ name: 'Bash', input: { command: 'ls' } }],
    files_changed: [],
    diff: '',
    outcome: { kind: 'done', summary: 'answered', reason: null },
};

describe('runTestScript', () => {
    it('passes on exit 0, reading the evidence files it was given', async () => {
        const body = 'grep -qi whopper reply.txt && grep -q "cat menu.txt" commands.txt && grep -q \'"done"\' outcome.json';
        expect(await runTestScript(body, evidence)).toEqual({ kind: 'passed' });
    });

    it('fails with what the script printed', async () => {
        const body = 'if grep -qi president reply.txt; then exit 0; fi\necho "reply never mentions the president"\nexit 1';
        expect(await runTestScript(body, evidence)).toEqual({ kind: 'failed', output: 'reply never mentions the president' });
    });

    it('fails with the exit code when it printed nothing', async () => {
        expect(await runTestScript('exit 3', { ...evidence, reply: null, commands: null, tool_calls: null, files_changed: null, diff: null })).toEqual({
            kind: 'failed',
            output: 'exited 3',
        });
    });
});
