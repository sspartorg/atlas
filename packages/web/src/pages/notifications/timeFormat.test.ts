import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relativeDay, relativeShort, timeOfDay } from './timeFormat.js';

describe('timeOfDay', () => {
    it('formats hours and minutes zero-padded', () => {
        const iso = new Date(2026, 5, 25, 7, 5).toISOString();
        expect(timeOfDay(iso)).toBe('07:05');
    });

    it('handles late hours', () => {
        const iso = new Date(2026, 5, 25, 23, 59).toISOString();
        expect(timeOfDay(iso)).toBe('23:59');
    });

    it('returns the raw string when parsing fails', () => {
        expect(timeOfDay('not-an-iso')).toBe('not-an-iso');
    });
});

describe('relativeDay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Wednesday 2026-06-24 noon
        vi.setSystemTime(new Date(2026, 5, 24, 12, 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns "today" for the same calendar day', () => {
        const iso = new Date(2026, 5, 24, 9, 30).toISOString();
        expect(relativeDay(iso)).toBe('today');
    });

    it('returns "yesterday" for the previous calendar day', () => {
        const iso = new Date(2026, 5, 23, 23, 59).toISOString();
        expect(relativeDay(iso)).toBe('yesterday');
    });

    it('returns "N d ago" inside the past week', () => {
        const iso = new Date(2026, 5, 20).toISOString();
        expect(relativeDay(iso)).toBe('4 d ago');
    });

    it('falls back to a locale date string beyond 7 days', () => {
        const iso = new Date(2026, 5, 15).toISOString();
        const out = relativeDay(iso);
        // Don't pin the exact locale string — just confirm it's a non-empty
        // calendar-shaped date and not the "N d ago" branch.
        expect(out).not.toBe('today');
        expect(out).not.toBe('yesterday');
        expect(/\d/.test(out)).toBe(true);
        expect(out.includes('d ago')).toBe(false);
    });

    it('returns "" when parsing fails', () => {
        expect(relativeDay('not-an-iso')).toBe('');
    });
});

describe('relativeShort', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-24T12:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns "just now" for under one minute', () => {
        const iso = new Date('2026-06-24T11:59:45.000Z').toISOString();
        expect(relativeShort(iso)).toBe('just now');
    });

    it('returns "Nm" between 1 and 59 minutes', () => {
        const iso59 = new Date('2026-06-24T11:01:00.000Z').toISOString();
        expect(relativeShort(iso59)).toBe('59m');
        const iso30 = new Date('2026-06-24T11:30:00.000Z').toISOString();
        expect(relativeShort(iso30)).toBe('30m');
    });

    it('crosses to "Nh" at the 60-minute boundary', () => {
        const iso = new Date('2026-06-24T11:00:00.000Z').toISOString();
        expect(relativeShort(iso)).toBe('1h');
    });

    it('returns "Nh" between 1 and 23 hours', () => {
        const iso = new Date('2026-06-24T07:00:00.000Z').toISOString();
        expect(relativeShort(iso)).toBe('5h');
    });

    it('returns "Nd" between 1 and 6 days', () => {
        const iso = new Date('2026-06-22T12:00:00.000Z').toISOString();
        expect(relativeShort(iso)).toBe('2d');
    });

    it('falls back to locale date beyond 7 days', () => {
        const iso = new Date('2026-06-10T12:00:00.000Z').toISOString();
        const out = relativeShort(iso);
        expect(out.includes('just now')).toBe(false);
        expect(/d$/.test(out)).toBe(false);
        expect(/\d/.test(out)).toBe(true);
    });

    it('returns "" when parsing fails', () => {
        expect(relativeShort('not-an-iso')).toBe('');
    });
});
