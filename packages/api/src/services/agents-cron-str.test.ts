// Covers the `err instanceof Error ? err.message : String(err)` false branch
// at line 52 of agents.ts inside assertCronExprValid. croner always throws
// Error instances in production, so we must mock it to throw a non-Error here.

import { describe, expect, it, afterAll, vi } from 'vitest';

// vi.mock is hoisted — must appear before any import that loads agents.ts
vi.mock('croner', () => ({
    Cron: vi.fn().mockImplementation(function (expr: string) {
        // Only throw non-Error for the special test-trigger expression;
        // all other expressions pass through as if valid.
        if (expr === '__nonErrorCronTrigger__') {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'non-error-from-croner';
        }
        // For other expressions behave like a valid Cron instance
        return {};
    }),
}));

import { assertCronExprValid, CronExpressionInvalidError } from './agents.js';
import { closeTestDb } from '../../tests/_pg-db.js';

afterAll(async () => {
    await closeTestDb();
});

describe('assertCronExprValid — String(err) fallback when croner throws non-Error (AGSTR-1)', () => {
    it('uses String(err) fallback when the croner constructor throws a non-Error (AGSTR-1)', () => {
        // Covers agents.ts line 52: `err instanceof Error ? err.message : String(err)`
        // The Cron mock above throws 'non-error-from-croner' (a string) for the
        // special trigger expression, so the `String(err)` branch fires.
        let caught: CronExpressionInvalidError | undefined;
        try {
            assertCronExprValid('__nonErrorCronTrigger__');
        } catch (e) {
            caught = e as CronExpressionInvalidError;
        }
        expect(caught).toBeInstanceOf(CronExpressionInvalidError);
        // The detail message uses String(err) = 'non-error-from-croner'
        expect(caught?.message).toContain('non-error-from-croner');
    });
});
