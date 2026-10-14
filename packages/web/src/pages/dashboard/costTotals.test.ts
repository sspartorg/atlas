import { describe, expect, it } from 'vitest';
import { costTotals } from './costTotals.js';

describe('costTotals', () => {
    it('is null with no summaries', () => {
        expect(costTotals(undefined, undefined)).toBeNull();
    });

    it('sums agent runs and terminal sessions', () => {
        expect(
            costTotals(
                {
                    total_cost_usd: 3,
                    run_count: 7,
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_read_tokens: 10,
                    cache_creation_tokens: 99,
                },
                {
                    total_cost_usd: 1.5,
                    session_count: 2,
                    input_tokens: 1,
                    output_tokens: 2,
                    cache_read_tokens: 3,
                    cache_creation_tokens: 99,
                }
            )
        ).toEqual({ usd: 4.5, runs: 7, tokens: 166 });
    });
});
