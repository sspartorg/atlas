// Covers the `e instanceof Error ? e.message : String(e)` false branch
// at line 39 of cron-materializer.ts inside the 'custom' case.
// croner always throws Error instances in production, so we mock it here.

import { describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted — must appear before any import that loads cron-materializer.ts
vi.mock('croner', () => ({
    Cron: vi.fn().mockImplementation(function () {
        // Always throw a non-Error string so the `String(e)` branch fires.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'non-error-from-croner-materializer';
    }),
}));

import { materializeCron } from './cron-materializer.js';

describe('materializeCron — String(e) fallback when croner throws non-Error (CRONSTR-1)', () => {
    it('custom preset: uses String(e) when the croner constructor throws a non-Error (CRONSTR-1)', () => {
        // Covers cron-materializer.ts line 39:
        // `Invalid cron expression: ${e instanceof Error ? e.message : String(e)}`
        // The mocked Cron always throws 'non-error-from-croner-materializer'.
        expect(() =>
            materializeCron({
                preset: 'custom',
                time_of_day: '',
                weekday: null,
                cron_expression: 'any-expr',
            })
        ).toThrow(/non-error-from-croner-materializer/);
    });
});
