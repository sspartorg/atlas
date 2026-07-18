import { describe, expect, it } from 'vitest';
import { formatCostUsd, formatTokenCount } from './formatCost.js';

describe('formatCostUsd', () => {
    it('returns em dash for null/undefined', () => {
        expect(formatCostUsd(null)).toBe('—');
        expect(formatCostUsd(undefined)).toBe('—');
    });

    it('returns $0.00 for zero', () => {
        expect(formatCostUsd(0)).toBe('$0.00');
    });

    it('uses 4 decimal places for sub-penny costs', () => {
        expect(formatCostUsd(0.0042)).toBe('$0.0042');
        expect(formatCostUsd(0.001)).toBe('$0.0010');
    });

    it('uses 2 decimal places for normal costs', () => {
        expect(formatCostUsd(1.234)).toBe('$1.23');
        expect(formatCostUsd(100)).toBe('$100.00');
    });
});

describe('formatTokenCount', () => {
    it('returns em dash for null/undefined', () => {
        expect(formatTokenCount(null)).toBe('—');
        expect(formatTokenCount(undefined)).toBe('—');
    });

    it('returns small numbers verbatim', () => {
        expect(formatTokenCount(0)).toBe('0');
        expect(formatTokenCount(42)).toBe('42');
        expect(formatTokenCount(999)).toBe('999');
    });

    it('uses K for thousands', () => {
        expect(formatTokenCount(1000)).toBe('1.0K');
        expect(formatTokenCount(12_500)).toBe('12.5K');
    });

    it('uses M for millions', () => {
        expect(formatTokenCount(1_000_000)).toBe('1.0M');
        expect(formatTokenCount(2_500_000)).toBe('2.5M');
    });
});
