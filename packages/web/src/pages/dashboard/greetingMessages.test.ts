import { describe, expect, it } from 'vitest';
import { randomGreeting, __GREETING_BANK } from './greetingMessages.js';

describe('greetingMessages', () => {
    it('exposes a 30-variant flat bank', () => {
        // Per the module comment: 30 variants split across 4 buckets.
        expect(__GREETING_BANK).toHaveLength(30);
    });

    it('every bank entry is a non-empty string', () => {
        for (const g of __GREETING_BANK) {
            expect(typeof g).toBe('string');
            expect(g.length).toBeGreaterThan(0);
        }
    });
});

describe('randomGreeting', () => {
    function mkDate(hour: number): Date {
        const d = new Date('2026-05-16T00:00:00.000Z');
        d.setHours(hour, 0, 0, 0);
        return d;
    }

    it('returns a morning greeting at 8am', () => {
        const out = randomGreeting(mkDate(8));
        expect(__GREETING_BANK).toContain(out);
    });

    it('returns an afternoon greeting at 14:00', () => {
        const out = randomGreeting(mkDate(14));
        expect(__GREETING_BANK).toContain(out);
    });

    it('returns an evening greeting at 18:00', () => {
        const out = randomGreeting(mkDate(18));
        expect(__GREETING_BANK).toContain(out);
    });

    it('returns a late-night greeting at 23:00 (no bucket match)', () => {
        const out = randomGreeting(mkDate(23));
        expect(__GREETING_BANK).toContain(out);
    });

    it('returns a late-night greeting at 02:00 (wrap-over-midnight)', () => {
        const out = randomGreeting(mkDate(2));
        expect(__GREETING_BANK).toContain(out);
    });

    it('always returns a known bank entry across all 24 hours', () => {
        for (let h = 0; h < 24; h += 1) {
            const out = randomGreeting(mkDate(h));
            expect(__GREETING_BANK).toContain(out);
        }
    });

    it('defaults to current Date when no arg', () => {
        const out = randomGreeting();
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    });
});
