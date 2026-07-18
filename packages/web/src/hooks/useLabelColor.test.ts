import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LABEL_COLORS } from '../theme/tokens.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useLabelColor } from './useLabelColor.js';

describe('useLabelColor', () => {
    it("returns the correct color pair for 'emerald' in light mode (default)", () => {
        // ThemeModeProvider defaults to light when localStorage has no persisted value.
        const { result } = renderHook(() => useLabelColor('emerald'), {
            wrapper: makeWrapper(),
        });
        expect(result.current).toEqual(LABEL_COLORS.emerald.light);
    });

    it("returns the dark color pair for 'emerald' when mode is dark", () => {
        // Persist dark mode so useThemeMode initialises to dark.
        window.localStorage.setItem('atlas.themeMode', 'dark');
        const { result } = renderHook(() => useLabelColor('emerald'), {
            wrapper: makeWrapper(),
        });
        expect(result.current).toEqual(LABEL_COLORS.emerald.dark);
        window.localStorage.removeItem('atlas.themeMode');
    });
});
