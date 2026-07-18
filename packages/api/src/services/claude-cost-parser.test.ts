import { describe, it, expect } from 'vitest';
import { parseClaudeCostFromOutput } from './claude-cost-parser.js';

// Most branches of parseClaudeCostFromOutput are already exercised
// indirectly via `parse-cost.test.ts` (which imports the re-export from
// `agent-runner.ts`). This file targets the two branches that fixture
// doesn't reach: the `catch` arm around `JSON.parse` (malformed JSON
// that still starts with `{`), and a `result` event with neither
// `total_cost_usd` nor `usage` present (the `continue` inside the loop).

describe('parseClaudeCostFromOutput — additional branch coverage', () => {
    it('skips a line that starts with `{` but is not valid JSON, and keeps searching backward', () => {
        const validResult = JSON.stringify({
            type: 'result',
            total_cost_usd: 0.05,
            usage: { input_tokens: 10, output_tokens: 20 },
        });
        const output = [
            '{"type":"system","subtype":"init"}',
            '{not valid json at all',
            validResult,
        ].join('\n');
        const cost = parseClaudeCostFromOutput(output);
        expect(cost).toEqual({
            total_cost_usd: 0.05,
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_tokens: null,
            cache_read_tokens: null,
            credits: null,
        });
    });

    it('returns null when malformed JSON is the only `{`-prefixed line (catch arm exhausts the search)', () => {
        const output = ['{"type":"system"}', '{still not json'].join('\n');
        // Neither line is a parseable `result` event: the first is valid
        // JSON but not type:"result"; the second throws in JSON.parse and
        // is skipped via the catch arm. Loop exhausts → null.
        expect(parseClaudeCostFromOutput(output)).toBeNull();
    });

    it('skips a `result` event with neither total_cost_usd nor usage (continues searching)', () => {
        const emptyResult = JSON.stringify({ type: 'result', subtype: 'success' });
        const validResult = JSON.stringify({
            type: 'result',
            total_cost_usd: 0.02,
            usage: { input_tokens: 5, output_tokens: 6 },
        });
        // The empty result is LATER in the output (scanned first, since the
        // function scans backward) — it must be skipped so the scan
        // continues to the earlier, populated result event.
        const output = [validResult, emptyResult].join('\n');
        const cost = parseClaudeCostFromOutput(output);
        expect(cost).toEqual({
            total_cost_usd: 0.02,
            input_tokens: 5,
            output_tokens: 6,
            cache_creation_tokens: null,
            cache_read_tokens: null,
            credits: null,
        });
    });

    it('returns null when the only result event has neither cost nor usage', () => {
        const emptyResult = JSON.stringify({ type: 'result', subtype: 'success' });
        expect(parseClaudeCostFromOutput(emptyResult)).toBeNull();
    });
});
