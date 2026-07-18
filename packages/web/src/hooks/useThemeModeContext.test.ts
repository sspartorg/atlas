import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useThemeModeContext } from './useThemeModeContext.js';

describe('useThemeModeContext', () => {
    it('throws when used outside ThemeModeProvider', () => {
        // Suppress the React error boundary output during this test.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => {
            renderHook(() => useThemeModeContext());
        }).toThrow('useThemeModeContext must be used inside <ThemeModeProvider>');
        spy.mockRestore();
    });

    it('returns mode, setMode, and toggle when used inside ThemeModeProvider', () => {
        const { result } = renderHook(() => useThemeModeContext(), {
            wrapper: makeWrapper(),
        });
        expect(result.current.mode).toMatch(/^(light|dark)$/);
        expect(typeof result.current.setMode).toBe('function');
        expect(typeof result.current.toggle).toBe('function');
    });
});
