import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNow } from './useNow.js';

describe('useNow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-16T00:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the current time and updates on tick', () => {
        const { result } = renderHook(() => useNow(1000));
        const initial = result.current;
        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(result.current).toBeGreaterThan(initial);
    });

    it('does not change before the interval', () => {
        const { result } = renderHook(() => useNow(60_000));
        const initial = result.current;
        act(() => {
            vi.advanceTimersByTime(100);
        });
        expect(result.current).toBe(initial);
    });

    it('uses default intervalMs of 60_000 when no argument provided', () => {
        const { result } = renderHook(() => useNow());
        const initial = result.current;
        // advance less than default interval — should not tick
        act(() => {
            vi.advanceTimersByTime(59_999);
        });
        expect(result.current).toBe(initial);
        // advance past the default interval — should tick now
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBeGreaterThan(initial);
    });

    it('clears the interval on unmount (clearInterval called)', () => {
        const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
        const { unmount } = renderHook(() => useNow(1000));
        unmount();
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        clearIntervalSpy.mockRestore();
    });
});
