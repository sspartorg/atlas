import type { IRunOutcome, IRunOutcomeChecklistItem, RunOutcomeKind } from '@atlas/shared';

// Task 12 — fenced-block parser. Every agent ends its CLI output with a
// `atlas-outcome` block; the runner scans the captured output_text on
// completion and turns it into a structured `IRunOutcome` for routing.
//
// Format the agent must emit:
//
//   ```atlas-outcome
//   outcome: done | rejected | asked_question
//   summary: |
//     What I did this round.
//     Multi-line OK after the | pipe.
//   reason: |
//     (only when outcome is 'rejected' or 'asked_question')
//   checklist:
//     - id: 1
//       passed: true
//     - id: 2
//       passed: false
//       evidence: "no tests yet"
//   ```
//
// A gate checker (ADR 0024) adds two keys to the same block rather than
// getting a protocol of its own:
//
//   ```atlas-outcome
//   outcome: done
//   applies: true
//   command: pnpm -s vitest run --coverage
//   summary: |
//     vitest.config.ts declares its own thresholds; --coverage exits non-zero
//     below the project's number.
//   ```
//
// `applies: false` means the concern does not exist in this project and the
// summary says why. An absent `applies`, or `applies: true` with no command,
// is not a pass — the engine parks, because a checker that named no proof
// produced no evidence.
//
// Hand-rolled parser (avoids a yaml dependency for a four-field block).
// Returns null when the block is missing or unparseable; the runner
// treats that as `'asked_question'` so a silent agent never advances
// the chain.

const VALID_OUTCOMES: ReadonlyArray<RunOutcomeKind> = ['done', 'rejected', 'asked_question'];
/** Matches `UpdateProjectRepoSchema.verify_command`, which stores the same strings. */
const MAX_COMMAND_LEN = 500;
const FENCE_RE = /```atlas-outcome\s*\n([\s\S]*?)\n```/g;

// Claude CLI runs under `--output-format=stream-json`: every event is a JSON
// object on its own line, and the agent's text lives inside JSON-escaped
// strings (`\n` is the two-character escape, not 0x0A). Regex-scanning the
// raw NDJSON would never match the fence. Mirror `parseClaudeCostFromOutput`
// (agent-runner.ts) and lift the final `type:result` line — JSON.parse turns
// `\n` back into real newlines so the existing fence regex matches.
//
// Copilot CLI emits plain text to stdout, so the fallback path (return null,
// scan raw output verbatim) keeps Copilot agents and the plaintext unit-test
// fixtures working unchanged.
function extractClaudeResultText(outputText: string): string | null {
    const lines = outputText.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        // reason: `i` is always within [0, lines.length) here, so
        // `lines[i]` is never undefined — the `?? ''` fallback exists only
        // to satisfy noUncheckedIndexedAccess and is unreachable at runtime.
        /* v8 ignore next */
        const line = (lines[i] ?? '').trim();
        if (!line.startsWith('{')) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj['type'] !== 'result') continue;
            const result = obj['result'];
            if (typeof result === 'string' && result.length > 0) return result;
        } catch {
            /* keep searching */
        }
    }
    return null;
}

/** Locate the LAST `atlas-outcome` block in the output; multiple is unusual but the last wins. */
function extractBlockBody(outputText: string): string | null {
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = FENCE_RE.exec(outputText)) !== null) {
        last = m;
    }
    if (!last || !last[1]) return null;
    return last[1];
}

interface ParsedField {
    key: string;
    value: string;
    indent: number;
}

/** Split a block body into top-level fields. Handles single-line and `|` block-scalar values. */
function splitFields(body: string): ParsedField[] {
    const lines = body.split('\n');
    const fields: ParsedField[] = [];
    let i = 0;
    while (i < lines.length) {
        // reason: `i` is always within [0, lines.length) here — the `?? ''`
        // fallback exists only to satisfy noUncheckedIndexedAccess.
        /* v8 ignore next */
        const line = lines[i] ?? '';
        const m = /^(\s*)([a-z_]+):\s*(.*)$/.exec(line);
        if (!m) {
            i += 1;
            continue;
        }
        const indent = m[1]!.length;
        const key = m[2]!;
        // reason: group 3 is `(.*)$` — it always matches (possibly empty
        // string) whenever `m` is non-null, so `m[3]` is never undefined.
        /* v8 ignore next */
        const rest = m[3] ?? '';
        if (indent !== 0) {
            // Nested under a previous field — handled by the field's own parser.
            i += 1;
            continue;
        }
        if (rest === '|') {
            // Block scalar; consume indented continuation lines.
            const chunks: string[] = [];
            i += 1;
            while (i < lines.length) {
                // reason: `i` is always within [0, lines.length) here — the
                // `?? ''` fallback exists only to satisfy noUncheckedIndexedAccess.
                /* v8 ignore next */
                const next = lines[i] ?? '';
                if (/^\S/.test(next) && next.length > 0) break;
                chunks.push(next.replace(/^ {2,4}/, ''));
                i += 1;
            }
            fields.push({ key, value: chunks.join('\n').trim(), indent });
        } else if (rest === '') {
            // Container (e.g. `checklist:`); slurp indented child lines.
            const chunks: string[] = [];
            i += 1;
            while (i < lines.length) {
                // reason: `i` is always within [0, lines.length) here — the
                // `?? ''` fallback exists only to satisfy noUncheckedIndexedAccess.
                /* v8 ignore next */
                const next = lines[i] ?? '';
                if (/^\S/.test(next) && next.length > 0) break;
                chunks.push(next);
                i += 1;
            }
            fields.push({ key, value: chunks.join('\n'), indent });
        } else {
            fields.push({ key, value: rest.trim(), indent });
            i += 1;
        }
    }
    return fields;
}

function unquote(s: string): string {
    const t = s.trim();
    if (
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))
    ) {
        return t.slice(1, -1);
    }
    return t;
}

function parseChecklist(raw: string): IRunOutcomeChecklistItem[] {
    const items: IRunOutcomeChecklistItem[] = [];
    const lines = raw.split('\n');
    let current: Partial<IRunOutcomeChecklistItem> | null = null;
    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');
        if (line.length === 0) continue;
        const start = /^\s*-\s+(.+)$/.exec(line);
        if (start) {
            if (current && typeof current.id === 'number' && typeof current.passed === 'boolean') {
                items.push(current as IRunOutcomeChecklistItem);
            }
            current = {};
            // reason: group 1 is `(.+)$` — it only matches when `start` is
            // non-null, so `start[1]` is never undefined here.
            /* v8 ignore next */
            const rest = start[1] ?? '';
            const kv = /^([a-z_]+):\s*(.*)$/.exec(rest);
            // reason: group 2 is `(.*)$` — it always matches (possibly
            // empty) whenever `kv` is non-null, so `kv[2]` is never undefined.
            /* v8 ignore next */
            if (kv) applyKv(current, kv[1]!, kv[2] ?? '');
            continue;
        }
        const kv = /^\s+([a-z_]+):\s*(.*)$/.exec(line);
        // reason: group 2 is `(.*)$` — it always matches (possibly empty)
        // whenever `kv` is non-null, so `kv[2]` is never undefined.
        /* v8 ignore next */
        if (kv && current) applyKv(current, kv[1]!, kv[2] ?? '');
    }
    if (current && typeof current.id === 'number' && typeof current.passed === 'boolean') {
        items.push(current as IRunOutcomeChecklistItem);
    }
    return items;
}

function applyKv(target: Partial<IRunOutcomeChecklistItem>, key: string, raw: string): void {
    const v = unquote(raw);
    if (key === 'id') {
        const n = Number(v);
        if (Number.isFinite(n) && Number.isInteger(n)) target.id = n;
    } else if (key === 'passed') {
        if (v === 'true') target.passed = true;
        else if (v === 'false') target.passed = false;
    } else if (key === 'evidence') {
        target.evidence = v;
    }
}

/**
 * Parse the last `atlas-outcome` block out of an agent's CLI output and
 * return a validated `IRunOutcome`. Returns null on:
 *   - missing block
 *   - missing/invalid `outcome` field
 *   - malformed body structure
 *
 * The runner consumes the null path as `'asked_question'`.
 */
export function parseRunOutcome(outputText: string | null | undefined): IRunOutcome | null {
    if (!outputText) return null;
    // Claude stream-json: try lifting the final `type:result` event first
    // (JSON-decoded text has real newlines). Falls back to raw output for
    // Copilot CLI / plaintext fixtures where there's no `result` event.
    const claudeResult = extractClaudeResultText(outputText);
    const scanText = claudeResult ?? outputText;
    const body = extractBlockBody(scanText);
    if (body === null) return null;
    const fields = splitFields(body);
    if (fields.length === 0) return null;

    let kind: RunOutcomeKind | null = null;
    let summary: string | undefined;
    let reason: string | undefined;
    let checklist: IRunOutcomeChecklistItem[] | undefined;
    let applies: boolean | undefined;
    let command: string | undefined;

    for (const f of fields) {
        if (f.key === 'outcome') {
            const v = unquote(f.value).toLowerCase();
            if ((VALID_OUTCOMES as ReadonlyArray<string>).includes(v)) {
                kind = v as RunOutcomeKind;
            }
        } else if (f.key === 'summary') {
            const v = f.value.trim();
            if (v.length > 0) summary = v;
        } else if (f.key === 'reason') {
            const v = f.value.trim();
            if (v.length > 0) reason = v;
        } else if (f.key === 'checklist') {
            const items = parseChecklist(f.value);
            if (items.length > 0) checklist = items;
        } else if (f.key === 'applies') {
            // Only the two literals. Anything else leaves it undefined, which
            // the gate router treats as "did not answer" rather than guessing
            // which way a checker meant "probably".
            const v = unquote(f.value).trim().toLowerCase();
            if (v === 'true') applies = true;
            else if (v === 'false') applies = false;
        } else if (f.key === 'command') {
            // One line. A block would be a script, and a script is what ADR
            // 0024 stopped shipping; the ceiling matches the column's.
            const v = unquote(f.value).trim();
            if (v.length > 0 && v.length <= MAX_COMMAND_LEN && !v.includes('\n')) command = v;
        }
    }

    if (kind === null) return null;
    const out: IRunOutcome = { kind };
    if (summary !== undefined) out.summary = summary;
    if (reason !== undefined) out.reason = reason;
    if (checklist !== undefined) out.checklist = checklist;
    if (applies !== undefined) out.applies = applies;
    if (command !== undefined) out.command = command;
    return out;
}
