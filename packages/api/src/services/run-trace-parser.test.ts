import { describe, expect, it } from 'vitest';
import { parseRunTrace } from './run-trace-parser.js';

// Fixtures follow the real shapes on disk: `system/subtype:init` carries `cwd`
// and no timestamp, assistant events carry `timestamp` and `parent_tool_use_id`,
// tool results flag `is_error`, and a transcript is free to contain `[stderr]`
// lines and a final half-written one.

const CWD = '/private/var/folders/zz/T/atlas-run-abc';
const line = (o: unknown) => JSON.stringify(o);

function assistant(blocks: unknown[], over: Record<string, unknown> = {}): string {
    return line({ type: 'assistant', timestamp: '2026-09-25T10:00:05.000Z', message: { content: blocks }, ...over });
}
function toolUse(name: string, input: Record<string, unknown> = {}): unknown {
    return { type: 'tool_use', name, input };
}

const CLAUDE = [
    line({ type: 'system', subtype: 'init', cwd: CWD, model: 'claude-opus-5', tools: ['Read'] }),
    assistant([{ type: 'thinking', thinking: 'plan' }]),
    assistant([toolUse('Read', { file_path: `${CWD}/.atlas/current-task.md` })]),
    line({ type: 'rate_limit_event', rate_limit_info: {} }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    assistant([toolUse('Bash', { command: 'pnpm test' })]),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'boom', is_error: true }] } }),
    assistant([toolUse('Edit', { file_path: `${CWD}/src/a.ts` })], { parent_tool_use_id: 'toolu_1' }),
    '[stderr] warning: something',
    line({ type: 'result', result: 'done' }),
].join('\n');

describe('parseRunTrace — claude', () => {
    const t = parseRunTrace(CLAUDE, 'claude', '2026-09-25T10:00:02.000Z')!;

    it('counts turns, tool calls and thinking blocks', () => {
        expect(t.source).toBe('claude');
        expect(t.turns).toBe(4);
        expect(t.tool_calls).toBe(3);
        expect(t.tools).toEqual({ Read: 1, Bash: 1, Edit: 1 });
        expect(t.tool_sequence).toEqual(['Read', 'Bash', 'Edit']);
        expect(t.thinking_blocks).toBe(1);
    });

    // The tool inputs are absolute against a temp sandbox that changes every
    // run. Left raw, `files_touched` is both unmatchable by any expectation and
    // a leak of the machine's temp layout into product data.
    it('reports file paths relative to the run’s own sandbox', () => {
        expect(t.files_touched).toEqual(['.atlas/current-task.md', 'src/a.ts']);
    });

    it('counts only tool results that failed', () => {
        expect(t.errors).toBe(1);
    });

    it('counts turns a sub-agent produced separately', () => {
        expect(t.subagent_turns).toBe(1);
    });

    // `system/init` carries no timestamp, so the run's own `started_at` is the
    // only thing the first assistant event can be measured against.
    it('measures time to first token from the run’s start', () => {
        expect(t.ttft_ms).toBe(3000);
    });

    it('leaves ttft null when it was not given a start', () => {
        expect(parseRunTrace(CLAUDE, 'claude')?.ttft_ms).toBeNull();
    });

    // Two machines, two clocks. A negative duration is not a measurement.
    it('refuses a first event that predates the run', () => {
        expect(parseRunTrace(CLAUDE, 'claude', '2026-09-25T10:00:09.000Z')?.ttft_ms).toBeNull();
    });

    it('ignores stderr lines and a half-written final one', () => {
        const torn = `${CLAUDE}\n{"type":"assistant","message":{"content":[{"type":"too`;
        expect(parseRunTrace(torn, 'claude')?.turns).toBe(4);
    });
});

describe('parseRunTrace — copilot', () => {
    const COPILOT = [
        line({ type: 'session.start', data: { selectedModel: 'gpt-5' } }),
        line({ type: 'assistant.message', timestamp: '2026-09-25T10:00:04.000Z', data: { content: 'working' } }),
        line({ type: 'tool.execution_start', data: { toolName: 'shell' } }),
        line({ type: 'tool.execution_complete', data: { toolName: 'shell', success: true } }),
        line({ type: 'tool.execution_start', data: { toolName: 'str_replace' } }),
        line({ type: 'tool.execution_complete', data: { toolName: 'str_replace', success: false } }),
        line({ type: 'assistant.message', data: { content: 'done' } }),
    ].join('\n');
    const t = parseRunTrace(COPILOT, 'copilot', '2026-09-25T10:00:02.000Z')!;

    it('reads tool names, order, turns and failures', () => {
        expect(t.source).toBe('copilot');
        expect(t.turns).toBe(2);
        expect(t.tools).toEqual({ shell: 1, str_replace: 1 });
        expect(t.tool_sequence).toEqual(['shell', 'str_replace']);
        expect(t.errors).toBe(1);
        expect(t.ttft_ms).toBe(2000);
    });

    // "We did not look" and "it did not happen" are different answers. A test
    // asserting on a field this CLI cannot report has to come back `errored`,
    // and it can only do that if the field is null rather than zero.
    it('reports what it cannot know as null, never zero', () => {
        expect(t.thinking_blocks).toBeNull();
        expect(t.files_touched).toBeNull();
        expect(t.subagent_turns).toBeNull();
    });
});

describe('parseRunTrace — nothing to read', () => {
    it('returns null for an absent or blank transcript', () => {
        expect(parseRunTrace(null, 'claude')).toBeNull();
        expect(parseRunTrace(undefined, 'claude')).toBeNull();
        expect(parseRunTrace('   \n  ', 'claude')).toBeNull();
    });

    it('returns an empty summary for output that is not a transcript at all', () => {
        const t = parseRunTrace('claude: command not found\nexit 127', 'claude')!;
        expect(t.turns).toBe(0);
        expect(t.tool_calls).toBe(0);
        expect(t.tool_sequence).toEqual([]);
    });

    // Runs from before `cli` was snapshotted still have transcripts worth
    // reading, but calling one `claude` would be asserting something we do not
    // know about a run nobody can re-inspect.
    it('reads an unsnapshotted run’s transcript but does not name its CLI', () => {
        const t = parseRunTrace(CLAUDE, null)!;
        expect(t.source).toBe('unknown');
        expect(t.tool_calls).toBe(3);
        expect(parseRunTrace('{"type":"nonsense"}', null)?.source).toBe('unknown');
    });
});

describe('parseRunTrace — caps', () => {
    it('stops recording the sequence past the cap and says so', () => {
        const many = Array.from({ length: 260 }, (_, i) => assistant([toolUse(`T${i}`)])).join('\n');
        const t = parseRunTrace(many, 'claude')!;
        expect(t.tool_calls).toBe(260);
        expect(t.tool_sequence).toHaveLength(200);
        expect(t.truncated).toBe(true);
        // The counts stay complete even when the ordered list is cut.
        expect(Object.keys(t.tools)).toHaveLength(260);
    });

    it('does not claim truncation when everything fitted', () => {
        expect(parseRunTrace(CLAUDE, 'claude')?.truncated).toBe(false);
    });
});

describe('parseRunTrace — shapes that are not quite right', () => {
    it('ignores an event whose message is not an object', () => {
        const t = parseRunTrace(
            [line({ type: 'assistant', message: 'just a string' }), line({ type: 'assistant', message: null })].join('\n'),
            'claude',
        )!;
        expect(t.turns).toBe(2);
        expect(t.tool_calls).toBe(0);
    });

    it('ignores an event whose content is not a list of blocks', () => {
        const t = parseRunTrace(line({ type: 'assistant', message: { content: 'text' } }), 'claude')!;
        expect(t.turns).toBe(1);
        expect(t.tool_calls).toBe(0);
    });

    // Without a `system/init` there is no cwd, so a path cannot be made
    // relative — it is reported as it was recorded rather than mangled.
    it('leaves a path alone when the run recorded no working directory', () => {
        const t = parseRunTrace(
            assistant([toolUse('Read', { file_path: '/elsewhere/a.ts' })]),
            'claude',
        )!;
        expect(t.files_touched).toEqual(['/elsewhere/a.ts']);
    });

    it('leaves a path alone when it is outside the run’s directory', () => {
        const t = parseRunTrace(
            [
                line({ type: 'system', subtype: 'init', cwd: CWD }),
                assistant([toolUse('Read', { file_path: '/somewhere/else.ts' })]),
            ].join('\n'),
            'claude',
        )!;
        expect(t.files_touched).toEqual(['/somewhere/else.ts']);
    });

    it('reads a path from whichever key the tool used for one', () => {
        const t = parseRunTrace(
            [
                line({ type: 'system', subtype: 'init', cwd: CWD }),
                assistant([toolUse('NotebookEdit', { notebook_path: `${CWD}/a.ipynb` })]),
                assistant([toolUse('Glob', { path: `${CWD}/src` })]),
                assistant([toolUse('Bash', { command: 'ls' })]),
            ].join('\n'),
            'claude',
        )!;
        expect(t.files_touched).toEqual(['a.ipynb', 'src']);
    });

    it('caps the file list and says the trace is partial', () => {
        const many = Array.from({ length: 130 }, (_, i) =>
            assistant([toolUse('Read', { file_path: `/f/${i}.ts` })]),
        ).join('\n');
        const t = parseRunTrace(many, 'claude')!;
        expect(t.files_touched).toHaveLength(100);
        expect(t.truncated).toBe(true);
    });

    it('caps a copilot run’s tool sequence too', () => {
        const many = Array.from({ length: 210 }, (_, i) =>
            line({ type: 'tool.execution_start', data: { toolName: `t${i}` } }),
        ).join('\n');
        const t = parseRunTrace(many, 'copilot')!;
        expect(t.tool_sequence).toHaveLength(200);
        expect(t.truncated).toBe(true);
    });

    it('ignores a copilot tool event with no name', () => {
        const t = parseRunTrace(line({ type: 'tool.execution_start', data: {} }), 'copilot')!;
        expect(t.tool_calls).toBe(0);
    });
});
