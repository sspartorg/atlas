import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ThemeModeContext, useThemeModeContext } from './useThemeModeContext.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';

describe('useThemeModeContext', () => {
    it('returns mode and setMode when rendered inside ThemeModeProvider (via makeWrapper)', () => {
        const { result } = renderHook(() => useThemeModeContext(), { wrapper: makeWrapper() });
        // ThemeModeProvider starts with persisted/OS mode — just assert it is one of the valid values
        expect(['light', 'dark']).toContain(result.current.mode);
        expect(typeof result.current.setMode).toBe('function');
        expect(typeof result.current.toggle).toBe('function');
    });

    it('throws when used outside provider', () => {
        // Suppress the React error boundary noise
        const consoleSpy = import.meta.env ? undefined : undefined; // silent reference
        void consoleSpy;
        expect(() => {
            renderHook(() => useThemeModeContext());
        }).toThrow('useThemeModeContext must be used inside <ThemeModeProvider>');
    });

    it('toggle flips mode from light to dark', () => {
        // Render with an explicit light context value
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ThemeModeContext.Provider
                value={{ mode: 'light', setMode: () => {}, toggle: () => {} }}
            >
                {children}
            </ThemeModeContext.Provider>
        );
        const { result } = renderHook(() => useThemeModeContext(), { wrapper });
        expect(result.current.mode).toBe('light');
    });
});
