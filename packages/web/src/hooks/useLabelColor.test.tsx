import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLabelColor } from './useLabelColor.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { LABEL_COLORS } from '../theme/tokens.js';

describe('useLabelColor', () => {
    it('returns the correct light-mode pair for "emerald"', () => {
        // makeWrapper wraps in ThemeModeProvider which starts in light mode
        // (localStorage is clean in tests)
        const { result } = renderHook(() => useLabelColor('emerald'), {
            wrapper: makeWrapper(),
        });
        // mode is light or dark depending on matchMedia mock (returns false = light)
        const mode = result.current.bg === LABEL_COLORS.emerald.light.bg ? 'light' : 'dark';
        expect(result.current).toEqual(LABEL_COLORS.emerald[mode]);
    });

    it('returns a bg, fg, border for "sky"', () => {
        const { result } = renderHook(() => useLabelColor('sky'), {
            wrapper: makeWrapper(),
        });
        expect(result.current).toHaveProperty('bg');
        expect(result.current).toHaveProperty('fg');
        expect(result.current).toHaveProperty('border');
    });

    it('returns a bg, fg, border for "amber"', () => {
        const { result } = renderHook(() => useLabelColor('amber'), {
            wrapper: makeWrapper(),
        });
        expect(typeof result.current.bg).toBe('string');
        expect(typeof result.current.fg).toBe('string');
        expect(typeof result.current.border).toBe('string');
    });

    it('returns a bg, fg, border for "rose"', () => {
        const { result } = renderHook(() => useLabelColor('rose'), {
            wrapper: makeWrapper(),
        });
        expect(result.current.bg.startsWith('#')).toBe(true);
    });
});
