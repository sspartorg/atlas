import { describe, expect, it } from 'vitest';
import { parseRunOutcome } from './run-outcome-parser.js';

describe('parseRunOutcome', () => {
    it('returns null when no atlas-outcome block is present', () => {
        expect(parseRunOutcome('just a regular run log')).toBeNull();
        expect(parseRunOutcome('')).toBeNull();
        expect(parseRunOutcome(null)).toBeNull();
        expect(parseRunOutcome(undefined)).toBeNull();
    });

    it('parses outcome=done with summary only', () => {
        const output = [
            'Doing the work…',
            '',
            '```atlas-outcome',
            'outcome: done',
            'summary: |',
            '  Built the labels editor.',
            '  Wrote tests.',
            '```',
        ].join('\n');
        expect(parseRunOutcome(output)).toEqual({
            kind: 'done',
            summary: 'Built the labels editor.\nWrote tests.',
        });
    });

    it('parses outcome=done with summary + full checklist', () => {
        const output = [
            'lots of irrelevant chatter above',
            '```atlas-outcome',
            'outcome: done',
            'summary: |',
            '  Created MON-5 and its QA twin.',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            '  - id: 2',
            '    passed: false',
            '    evidence: "no tests yet"',
            '```',
            'trailing log line ignored',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result).toEqual({
            kind: 'done',
            summary: 'Created MON-5 and its QA twin.',
            checklist: [
                { id: 1, passed: true },
                { id: 2, passed: false, evidence: 'no tests yet' },
            ],
        });
    });

    it('parses outcome=rejected with reason', () => {
        const output = [
            '```atlas-outcome',
            'outcome: rejected',
            'reason: |',
            '  The PR diff drops a public API without a deprecation window.',
            '```',
        ].join('\n');
        expect(parseRunOutcome(output)).toEqual({
            kind: 'rejected',
            reason: 'The PR diff drops a public API without a deprecation window.',
        });
    });

    it('parses outcome=asked_question with reason', () => {
        const output = [
            '```atlas-outcome',
            'outcome: asked_question',
            'reason: Need owner to decide between option A and option B.',
            '```',
        ].join('\n');
        expect(parseRunOutcome(output)).toEqual({
            kind: 'asked_question',
            reason: 'Need owner to decide between option A and option B.',
        });
    });

    it('uses the LAST atlas-outcome block when multiple are present', () => {
        const output = [
            '```atlas-outcome',
            'outcome: asked_question',
            'reason: first attempt',
            '```',
            '',
            'Owner answered; continuing.',
            '',
            '```atlas-outcome',
            'outcome: done',
            'summary: completed after answer',
            '```',
        ].join('\n');
        expect(parseRunOutcome(output)).toEqual({
            kind: 'done',
            summary: 'completed after answer',
        });
    });

    it('returns null when outcome value is missing or invalid', () => {
        expect(
            parseRunOutcome('```atlas-outcome\nsummary: forgot outcome\n```'),
        ).toBeNull();
        expect(
            parseRunOutcome('```atlas-outcome\noutcome: maybe\n```'),
        ).toBeNull();
    });

    it('ignores malformed checklist items but keeps well-formed ones', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            '  - garbage line',
            '  - id: notanumber',
            '    passed: true',
            '  - id: 3',
            '    passed: false',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.checklist).toEqual([
            { id: 1, passed: true },
            { id: 3, passed: false },
        ]);
    });

    it('returns null when block body has no recognizable key:value lines (fields.length === 0)', () => {
        // A atlas-outcome block that contains only blank lines and garbage
        // triggers the `if (fields.length === 0) return null` path.
        expect(parseRunOutcome('```atlas-outcome\n\n   ~~~\n\n```')).toBeNull();
    });

    it('skips indented top-level keys in splitFields (indent !== 0 branch)', () => {
        // An indented key at the top level of the block body (unusual but possible)
        // hits the `if (indent !== 0)` branch in splitFields and is skipped.
        // The outcome key is unindented and therefore parsed correctly.
        const output = [
            '```atlas-outcome',
            'outcome: done',
            '    nested_key: ignored_value',
            'summary: works fine',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBe('works fine');
    });

    it('parses outcome with single-quoted value (unquote single-quote branch)', () => {
        // outcome: 'done' — single quotes should be stripped by unquote()
        const output = [
            '```atlas-outcome',
            "outcome: 'done'",
            'summary: single-quoted outcome',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBe('single-quoted outcome');
    });

    it('parses checklist evidence with single-quoted value (unquote single-quote in applyKv)', () => {
        // evidence: 'some note' — single quotes stripped by unquote inside applyKv
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 5',
            '    passed: false',
            "    evidence: 'needs more tests'",
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.checklist?.[0]).toEqual({ id: 5, passed: false, evidence: 'needs more tests' });
    });

    it('skips non-JSON lines in NDJSON and still finds the type:result event', () => {
        // Lines that don't start with '{' should be skipped (the `continue` branch
        // in extractClaudeResultText). Mix plain text with NDJSON.
        const finalText = [
            '```atlas-outcome',
            'outcome: done',
            'summary: found via ndjson skip',
            '```',
        ].join('\n');
        const ndjson = [
            'plain text line (no brace)',
            '  indented line',
            JSON.stringify({ type: 'result', result: finalText }),
        ].join('\n');
        const result = parseRunOutcome(ndjson);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBe('found via ndjson skip');
    });

    it('skips malformed JSON lines and type:result with empty result, falls back to raw scan', () => {
        // { invalid json } causes JSON.parse to throw → catch branch (keep searching)
        // { type: 'result', result: '' } has result.length === 0 → keep searching
        // Both exhausted → claudeResult is null → scans raw outputText directly
        const fence = '```atlas-outcome\noutcome: rejected\nreason: found in raw\n```';
        const ndjson = [
            '{ not valid json at all >>>',
            JSON.stringify({ type: 'result', result: '' }),
            fence,
        ].join('\n');
        const result = parseRunOutcome(ndjson);
        expect(result?.kind).toBe('rejected');
        expect(result?.reason).toBe('found in raw');
    });

    // Claude CLI runs under `--output-format=stream-json`. The agent's text
    // (including the fenced atlas-outcome block) lives inside JSON-escaped
    // strings — every newline is the two-character escape `\n`, not 0x0A.
    // The parser must decode the final `type:result` line before scanning.
    it('parses atlas-outcome embedded in Claude stream-json NDJSON output', () => {
        const finalText = [
            'All steps complete. Every required item is wired.',
            '',
            '```atlas-outcome',
            'outcome: done',
            'summary: |',
            '  Created MON-2 and its QA twin MON-3.',
            '  Linked tested_by; set worktree_branch on both.',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            '    evidence: "As-a/I-want/so-that present"',
            '  - id: 2',
            '    passed: true',
            '  - id: 3',
            '    passed: true',
            '```',
        ].join('\n');
        const ndjson = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'working…' }] },
            }),
            JSON.stringify({
                type: 'result',
                subtype: 'success',
                is_error: false,
                result: finalText,
            }),
        ].join('\n');

        const result = parseRunOutcome(ndjson);
        expect(result).toEqual({
            kind: 'done',
            summary:
                'Created MON-2 and its QA twin MON-3.\nLinked tested_by; set worktree_branch on both.',
            checklist: [
                { id: 1, passed: true, evidence: 'As-a/I-want/so-that present' },
                { id: 2, passed: true },
                { id: 3, passed: true },
            ],
        });
    });

    // splitFields: block-scalar (`|`) body with a blank line that starts
    // with a non-space char of length 0 — the inner while loop's `next.length > 0`
    // branch (the `if (/^\S/.test(next) && next.length > 0) break` arms).
    it('block-scalar summary tolerates a trailing empty line inside the block', () => {
        // The blank line '' at the end of the block scalar is NOT a break
        // trigger (next.length === 0), so the parser stays in the chunk loop.
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'summary: |',
            '  First line.',
            '',
            '  Third line.',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        // Both lines survive (trimmed join keeps them).
        expect(result?.summary).toContain('First line.');
        expect(result?.summary).toContain('Third line.');
    });

    // applyKv: id is a float — Number.isFinite(n) is true but Number.isInteger(n) is false.
    // The id should NOT be applied.
    it('rejects checklist id that is a float (isInteger guard)', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 1.5',
            '    passed: true',
            '  - id: 2',
            '    passed: false',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        // id: 1.5 is not integer → item is incomplete → not pushed
        // id: 2 is integer → item is pushed
        expect(result?.checklist).toEqual([{ id: 2, passed: false }]);
    });

    // parseChecklist: an item that has id but no `passed` key should not be pushed.
    it('drops a checklist item that has id but is missing passed', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 10',
            '  - id: 11',
            '    passed: true',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        // id:10 has no `passed` → not pushed; id:11 is valid
        expect(result?.checklist).toEqual([{ id: 11, passed: true }]);
    });

    // container field (`checklist:` with value '') — the
    // `else if (rest === '')` path in splitFields. A bare key with no
    // indented children should resolve to an empty checklist (items=[]).
    it('empty checklist container field produces no checklist on result', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'summary: bare container',
            'checklist:',
            '```',
        ].join('\n');
        // checklist is empty → items.length === 0 → checklist stays undefined
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.checklist).toBeUndefined();
    });

    // extractClaudeResultText: the scan walks backward from the last line,
    // so a well-formed JSON line whose `type` is NOT `result` must appear
    // AFTER the real result event to actually hit the `continue` at line 53
    // (a trailing non-result event, e.g. a final "done" ping some CLIs emit).
    it('skips a valid trailing JSON line whose type is not "result" while scanning NDJSON', () => {
        const finalText = [
            '```atlas-outcome',
            'outcome: done',
            'summary: found before a trailing non-result event',
            '```',
        ].join('\n');
        const ndjson = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({ type: 'result', result: finalText }),
            JSON.stringify({ type: 'ping' }),
        ].join('\n');
        const result = parseRunOutcome(ndjson);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBe('found before a trailing non-result event');
    });

    // splitFields: the container-slurp loop for `checklist:` must be able to
    // break out early when a later top-level field follows it in the body
    // (line 113's `if (/^\S/.test(next) && next.length > 0) break;`).
    it('stops slurping checklist children when a later top-level field follows', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            'summary: field after checklist container',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.checklist).toEqual([{ id: 1, passed: true }]);
        expect(result?.summary).toBe('field after checklist container');
    });

    // parseChecklist: an indented `key: value` continuation line that
    // appears before any `- ` start line has no `current` item to attach
    // to — the `if (kv && current)` guard's false arm (current is null).
    it('ignores an indented checklist continuation line with no preceding "- " item', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  passed: true',
            '  - id: 7',
            '    passed: false',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.checklist).toEqual([{ id: 7, passed: false }]);
    });

    // outcome loop: `summary: ` with only whitespace after the colon trims
    // to an empty string — the `if (v.length > 0)` false arm.
    it('does not set summary when the value trims to empty', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'summary:    ',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBeUndefined();
    });

    // Same false arm as above but for `reason`.
    it('does not set reason when the value trims to empty', () => {
        const output = [
            '```atlas-outcome',
            'outcome: rejected',
            'reason:    ',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('rejected');
        expect(result?.reason).toBeUndefined();
    });

    // outcome loop: a top-level field whose key is none of
    // outcome/summary/reason/checklist falls through every `else if`
    // arm (the final `else if (f.key === 'checklist')` false branch).
    it('ignores unrecognized top-level fields', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'unknown_field: some value',
            'summary: still parsed',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.kind).toBe('done');
        expect(result?.summary).toBe('still parsed');
    });

    // applyKv: `passed` with a value that is neither "true" nor "false"
    // hits the `else if (v === 'false')` false arm — the field is left
    // unset, so the item is incomplete and dropped.
    it('drops a checklist item whose passed value is neither true nor false', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 1',
            '    passed: maybe',
            '  - id: 2',
            '    passed: true',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.checklist).toEqual([{ id: 2, passed: true }]);
    });

    // applyKv: a checklist child key that is none of id/passed/evidence
    // hits the final `else if (key === 'evidence')` false arm and is
    // silently ignored; the rest of the item is still parsed normally.
    it('ignores unrecognized checklist child keys', () => {
        const output = [
            '```atlas-outcome',
            'outcome: done',
            'checklist:',
            '  - id: 1',
            '    passed: true',
            '    note: irrelevant extra field',
            '```',
        ].join('\n');
        const result = parseRunOutcome(output);
        expect(result?.checklist).toEqual([{ id: 1, passed: true }]);
    });
});
