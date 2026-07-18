import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAbsolute, formatDate, formatDurationSec, relativeTime } from './time.js';

describe('relativeTime', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-16T12:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns em dash for nullish input', () => {
        expect(relativeTime(null)).toBe('—');
        expect(relativeTime(undefined)).toBe('—');
    });

    it('returns em dash for invalid ISO strings', () => {
        expect(relativeTime('not-a-date')).toBe('—');
    });

    it('returns "just now" for under one minute', () => {
        expect(relativeTime('2026-05-16T11:59:30.000Z')).toBe('just now');
    });

    it('returns Nm ago for minute-scale diffs', () => {
        expect(relativeTime('2026-05-16T11:55:00.000Z')).toBe('5m ago');
    });

    it('returns Nh ago for hour-scale diffs', () => {
        expect(relativeTime('2026-05-16T09:00:00.000Z')).toBe('3h ago');
    });

    it('returns "yesterday" for one-day-ago', () => {
        expect(relativeTime('2026-05-15T11:00:00.000Z')).toBe('yesterday');
    });

    it('returns Nd ago for under one week', () => {
        expect(relativeTime('2026-05-13T12:00:00.000Z')).toBe('3d ago');
    });

    it('returns Nw ago for under one month', () => {
        expect(relativeTime('2026-05-01T12:00:00.000Z')).toBe('2w ago');
    });

    it('falls back to localeDateString for older', () => {
        const out = relativeTime('2024-01-01T00:00:00.000Z');
        expect(out).not.toBe('—');
        expect(out).not.toMatch(/ago$/);
    });
});

describe('formatAbsolute', () => {
    it('returns em dash for nullish', () => {
        expect(formatAbsolute(null)).toBe('—');
        expect(formatAbsolute(undefined)).toBe('—');
    });

    it('returns em dash for invalid ISO', () => {
        expect(formatAbsolute('not-a-date')).toBe('—');
    });

    it('formats a valid ISO string with bullet separator', () => {
        const out = formatAbsolute('2026-05-16T14:23:00.000Z');
        expect(out).toContain('·');
        expect(out).not.toBe('—');
    });
});

describe('formatDate', () => {
    it('returns em dash for nullish', () => {
        expect(formatDate(null)).toBe('—');
        expect(formatDate(undefined)).toBe('—');
    });

    it('returns em dash for invalid', () => {
        expect(formatDate('garbage')).toBe('—');
    });

    it('formats valid ISO strings', () => {
        const out = formatDate('2026-05-16T00:00:00.000Z');
        expect(out).not.toBe('—');
        expect(typeof out).toBe('string');
    });
});

describe('formatDurationSec', () => {
    it('returns em dash for null', () => {
        expect(formatDurationSec(null)).toBe('—');
    });

    it('formats sub-minute durations with 1 decimal', () => {
        expect(formatDurationSec(45.5)).toBe('45.5 s');
        expect(formatDurationSec(12)).toBe('12.0 s');
    });

    it('formats minute-plus durations as Nm Ss', () => {
        expect(formatDurationSec(125)).toBe('2m 5s');
    });

    it('formats exactly 60 as 1m 0s', () => {
        expect(formatDurationSec(60)).toBe('1m 0s');
    });
});
