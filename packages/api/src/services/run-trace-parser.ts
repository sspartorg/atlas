import type { AgentCli } from '@atlas/shared';

// What an agent actually DID, from the transcript it already wrote.
//
// Every dispatch stores its raw stream-json in `agent_runs.output_text`, and
// until now nothing server-side has read it. So a test could assert only what
// the agent said about itself in its `atlas-outcome` block — the one part of a
// run the agent authors — while the record of every tool it called, every file
// it touched and every turn it took sat unparsed in the same row.
//
// That is the gap this closes: "it can see what the agent said at the end, not
// how it worked". No new capture layer, no OpenTelemetry, no extra column to
// write at runtime — the evidence was always there.
//
// Kept separate from `run-outcome-parser.ts` rather than bolted onto it: that
// file returns one type, sits on the routing hot path and is at its coverage
// ceiling. The two share a ~12-line NDJSON walk, which is cheaper than the
// shared helper that would couple them.

/** Ordered tool names get long and nobody reads past the first page of one. */
const SEQUENCE_CAP = 200;
/** A run can touch a lot of files; the list is for assertions, not an audit. */
const FILES_CAP = 100;

export interface RunTraceSummary {
    source: 'claude' | 'copilot' | 'unknown';
    /** Assistant messages — how many turns it took. */
    turns: number;
    tool_calls: number;
    /** Tool name → how many times it was called. */
    tools: Record<string, number>;
    /** The order they were called in, capped. */
    tool_sequence: string[];
    /**
     * `null` where a CLI cannot answer, never `0`.
     *
     * "We did not look" and "it did not happen" are different answers, and a
     * test asserting on a field this CLI cannot report must come back `errored`
     * rather than silently passing — the same hole ADR 0020 closed for a gate
     * that could not run.
     */
    thinking_blocks: number | null;
    /** Events emitted by a sub-agent the run spawned (`parent_tool_use_id`). */
    subagent_turns: number | null;
    /** Paths from tool inputs, relative to the run's cwd. */
    files_touched: string[] | null;
    /** Tool results flagged `is_error`. */
    errors: number | null;
    /** Run start → first assistant event. Needs `startedAt`; the transcript has none. */
    ttft_ms: number | null;
    /** A cap was hit, so `tool_sequence` or `files_touched` is partial. */
    truncated: boolean;
}

interface Block {
    type?: unknown;
    name?: unknown;
    input?: Record<string, unknown>;
    is_error?: unknown;
}

function blocksOf(event: Record<string, unknown>): Block[] {
    const message = event['message'];
    if (typeof message !== 'object' || message === null) return [];
    const content = (message as { content?: unknown }).content;
    return Array.isArray(content) ? (content as Block[]) : [];
}

/** The path a tool input names, under whichever key that tool uses for one. */
function pathOf(input: Record<string, unknown> | undefined): string | null {
    for (const key of ['file_path', 'path', 'notebook_path']) {
        const v = input?.[key];
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
}

function relative(path: string, cwd: string | null): string {
    if (!cwd || !path.startsWith(cwd)) return path;
    return path.slice(cwd.length).replace(/^[/\\]/, '');
}

function eachLine(output: string, visit: (event: Record<string, unknown>) => void): void {
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        // A transcript routinely carries `[stderr] …` lines and, if the process
        // died mid-write, a final truncated one. Neither is a parse failure.
        if (!trimmed.startsWith('{')) continue;
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed !== null) visit(parsed as Record<string, unknown>);
        } catch {
            /* a half-written line is not evidence of anything */
        }
    }
}

function empty(source: RunTraceSummary['source']): RunTraceSummary {
    return {
        source,
        turns: 0,
        tool_calls: 0,
        tools: {},
        tool_sequence: [],
        thinking_blocks: null,
        subagent_turns: null,
        files_touched: null,
        errors: null,
        ttft_ms: null,
        truncated: false,
    };
}

function parseClaude(output: string, startedAt: string | null): RunTraceSummary {
    const out = empty('claude');
    out.thinking_blocks = 0;
    out.subagent_turns = 0;
    out.errors = 0;
    const files = new Set<string>();
    let cwd: string | null = null;
    let firstAt: string | null = null;

    eachLine(output, (event) => {
        const type = event['type'];
        if (type === 'system' && event['subtype'] === 'init') {
            // The sandbox path every tool input is absolute against. Without it
            // `files_touched` reads as `/private/var/folders/.../atlas-run-…`,
            // which no expectation could ever match and which leaks the
            // machine's temp layout into product data.
            if (typeof event['cwd'] === 'string') cwd = event['cwd'];
            return;
        }
        if (type === 'assistant') {
            out.turns += 1;
            if (event['parent_tool_use_id']) (out.subagent_turns as number) += 1;
            if (firstAt === null && typeof event['timestamp'] === 'string') firstAt = event['timestamp'];
            for (const block of blocksOf(event)) {
                if (block.type === 'thinking') (out.thinking_blocks as number) += 1;
                if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
                out.tool_calls += 1;
                out.tools[block.name] = (out.tools[block.name] ?? 0) + 1;
                if (out.tool_sequence.length < SEQUENCE_CAP) out.tool_sequence.push(block.name);
                else out.truncated = true;
                const path = pathOf(block.input);
                if (path !== null) {
                    if (files.size < FILES_CAP) files.add(path);
                    else out.truncated = true;
                }
            }
            return;
        }
        if (type === 'user') {
            for (const block of blocksOf(event)) {
                if (block.type === 'tool_result' && block.is_error === true) (out.errors as number) += 1;
            }
        }
    });

    out.files_touched = [...files].map((f) => relative(f, cwd)).sort();
    if (startedAt !== null && firstAt !== null) {
        const ms = new Date(firstAt).getTime() - new Date(startedAt).getTime();
        // A clock that ran backwards is not a measurement.
        if (Number.isFinite(ms) && ms >= 0) out.ttft_ms = ms;
    }
    return out;
}

/**
 * Copilot reports less, and says so.
 *
 * Tool names, counts, ordering and turns all survive — it emits
 * `tool.execution_start` with `data.toolName`. Thinking blocks have no
 * equivalent event, and tool arguments are not in `data`, so the files it
 * touched cannot be known. Those stay `null`.
 */
function parseCopilot(output: string, startedAt: string | null): RunTraceSummary {
    const out = empty('copilot');
    out.errors = 0;
    let firstAt: string | null = null;

    eachLine(output, (event) => {
        const type = event['type'];
        const data = (event['data'] ?? {}) as Record<string, unknown>;
        if (type === 'assistant.message') {
            out.turns += 1;
            if (firstAt === null && typeof event['timestamp'] === 'string') firstAt = event['timestamp'];
            return;
        }
        if (type === 'tool.execution_start' && typeof data['toolName'] === 'string') {
            const name = data['toolName'];
            out.tool_calls += 1;
            out.tools[name] = (out.tools[name] ?? 0) + 1;
            if (out.tool_sequence.length < SEQUENCE_CAP) out.tool_sequence.push(name);
            else out.truncated = true;
            return;
        }
        if (type === 'tool.execution_complete' && data['success'] === false) {
            (out.errors as number) += 1;
        }
    });

    if (startedAt !== null && firstAt !== null) {
        const ms = new Date(firstAt).getTime() - new Date(startedAt).getTime();
        if (Number.isFinite(ms) && ms >= 0) out.ttft_ms = ms;
    }
    return out;
}

/**
 * Summarise one dispatch's transcript.
 *
 * `null` when there is nothing to read — which is what every run before this
 * shipped returns, and why consumers must render it as "—" rather than zero.
 */
export function parseRunTrace(
    outputText: string | null | undefined,
    cli: AgentCli | null | undefined,
    startedAt?: string | null,
): RunTraceSummary | null {
    if (!outputText || outputText.trim().length === 0) return null;
    const at = startedAt ?? null;
    if (cli === 'copilot') return parseCopilot(outputText, at);
    if (cli === 'claude') return parseClaude(outputText, at);
    // An older run has no `cli` snapshot. Claude's shape is the one Atlas has
    // written for most of its life, and a transcript it cannot read comes back
    // as zeroes rather than a lie about a CLI it never ran.
    const guess = parseClaude(outputText, at);
    return guess.turns === 0 && guess.tool_calls === 0 ? empty('unknown') : { ...guess, source: 'unknown' };
}
