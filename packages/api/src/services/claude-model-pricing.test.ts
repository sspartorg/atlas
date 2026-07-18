import { describe, expect, it } from 'vitest';
import { CLAUDE_MODEL_PRICING, lookupClaudePrices } from './claude-model-pricing.js';

describe('lookupClaudePrices', () => {
    it('returns the exact entry when the id is a verbatim key (CMP-EXACT)', () => {
        expect(lookupClaudePrices('claude-haiku-4-5')).toEqual(
            CLAUDE_MODEL_PRICING['claude-haiku-4-5'],
        );
    });

    it('strips the YYYYMMDD date suffix to find the base model (CMP-DATED)', () => {
        // Real atlas session model from a live Claude PTY transcript.
        expect(lookupClaudePrices('claude-haiku-4-5-20251001')).toEqual(
            CLAUDE_MODEL_PRICING['claude-haiku-4-5'],
        );
        expect(lookupClaudePrices('claude-opus-4-7-20260416')).toEqual(
            CLAUDE_MODEL_PRICING['claude-opus-4-7'],
        );
    });

    it('prefix-matches non-date suffixes like -latest / -beta (CMP-PREFIX)', () => {
        expect(lookupClaudePrices('claude-opus-4-7-latest')).toEqual(
            CLAUDE_MODEL_PRICING['claude-opus-4-7'],
        );
        expect(lookupClaudePrices('claude-sonnet-4-6-beta')).toEqual(
            CLAUDE_MODEL_PRICING['claude-sonnet-4-6'],
        );
    });

    it('picks the LONGEST prefix when several match (CMP-PREFIX-LONGEST)', () => {
        // 'claude-opus-4-7-...' must resolve to claude-opus-4-7 (not the
        // shorter claude-opus-4 entry).
        const longest = lookupClaudePrices('claude-opus-4-7-rc1');
        expect(longest).toEqual(CLAUDE_MODEL_PRICING['claude-opus-4-7']);
        // Sanity: the shorter key DOES exist in the table.
        expect(CLAUDE_MODEL_PRICING['claude-opus-4']).toBeDefined();
        expect(longest).not.toEqual(CLAUDE_MODEL_PRICING['claude-opus-4']);
    });

    it('returns null for genuinely unknown models (CMP-UNKNOWN)', () => {
        expect(lookupClaudePrices('not-a-claude-model')).toBeNull();
        expect(lookupClaudePrices('gpt-4o')).toBeNull();
        expect(lookupClaudePrices('')).toBeNull();
    });

    it('falls through to the prefix scan (and still returns null) when a date-stripped unknown id has no direct match (CMP-DATED-UNKNOWN)', () => {
        // Exercises `stripped !== modelId` === true followed by
        // `byStripped` === false (falsy CLAUDE_MODEL_PRICING lookup),
        // which is otherwise untested — CMP-DATED only covers the
        // byStripped-truthy side and CMP-UNKNOWN never has a date suffix.
        expect(lookupClaudePrices('not-a-claude-model-20260101')).toBeNull();
    });

    it('opus-4-7 pricing matches LiteLLM 2026-06-30 snapshot (CMP-OPUS47-VALUES)', () => {
        // Anchor the actual numbers so a future copy-paste error gets
        // caught. These values came from LiteLLM's
        // model_prices_and_context_window.json — same upstream ccusage
        // uses, so cost should agree with the user's status line.
        const opus = CLAUDE_MODEL_PRICING['claude-opus-4-7'];
        expect(opus).toEqual({
            input: 5.0,
            output: 25.0,
            cache_write_5m: 6.25,
            cache_write_1h: 10.0,
            cache_read: 0.5,
        });
    });

    it('haiku-4-5 pricing matches LiteLLM 2026-06-30 snapshot (CMP-HAIKU45-VALUES)', () => {
        expect(CLAUDE_MODEL_PRICING['claude-haiku-4-5']).toEqual({
            input: 1.0,
            output: 5.0,
            cache_write_5m: 1.25,
            cache_write_1h: 2.0,
            cache_read: 0.1,
        });
    });
});
