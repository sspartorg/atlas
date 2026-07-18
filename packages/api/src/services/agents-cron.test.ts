import { describe, expect, it } from 'vitest';
import { assertCronExprValid, CronExpressionInvalidError } from './agents.js';

// Pure unit tests for the cron-expression guard. Keeps the service-layer
// behaviour pinned without touching the DB. The integration / scheduler
// behavior is already covered by `agent-schedule-registry.test.ts` (cron_expr
// override branch) and `agentsService.update` advancing next_run_at on cron
// changes is exercised by the schedule registry tests too — what this file
// adds is the boundary check that bad input throws a tagged error.

describe('assertCronExprValid', () => {
    it('accepts valid 5-field expressions', () => {
        expect(() => assertCronExprValid('0 9 * * *')).not.toThrow();
        expect(() => assertCronExprValid('*/5 * * * *')).not.toThrow();
        expect(() => assertCronExprValid('0 9 * * 1-5')).not.toThrow();
    });

    it('accepts null and undefined (no cron set)', () => {
        expect(() => assertCronExprValid(null)).not.toThrow();
        expect(() => assertCronExprValid(undefined)).not.toThrow();
    });

    it('treats empty / whitespace-only as no-op (lets schedule_preset win)', () => {
        expect(() => assertCronExprValid('')).not.toThrow();
        expect(() => assertCronExprValid('   ')).not.toThrow();
    });

    it('throws CronExpressionInvalidError for unparseable input', () => {
        expect(() => assertCronExprValid('not a cron')).toThrow(CronExpressionInvalidError);
        expect(() => assertCronExprValid('* * * *')).toThrow(CronExpressionInvalidError);
    });

    it("includes the value and the parser's diagnostic in the message", () => {
        try {
            assertCronExprValid('bogus');
            throw new Error('expected to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(CronExpressionInvalidError);
            expect((err as Error).message).toContain('bogus');
        }
    });
});
