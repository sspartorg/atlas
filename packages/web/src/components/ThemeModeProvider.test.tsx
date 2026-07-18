import { describe, expect, it } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ThemeModeProvider } from './ThemeModeProvider.js';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';
import { render } from '@testing-library/react';

describe('ThemeModeProvider', () => {
    it('provides mode and setMode to children via context', () => {
        const { result } = renderHook(() => useThemeModeContext(), {
            wrapper: ({ children }) => <ThemeModeProvider>{children}</ThemeModeProvider>,
        });
        expect(['light', 'dark']).toContain(result.current.mode);
        expect(typeof result.current.setMode).toBe('function');
        expect(typeof result.current.toggle).toBe('function');
    });

    it('renders children', () => {
        render(
            <ThemeModeProvider>
                <span data-testid="child">hello</span>
            </ThemeModeProvider>,
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('toggle switches mode from light to dark', () => {
        // Force light mode by clearing localStorage
        localStorage.removeItem('atlas.themeMode');
        const { result } = renderHook(() => useThemeModeContext(), {
            wrapper: ({ children }) => <ThemeModeProvider>{children}</ThemeModeProvider>,
        });
        const initialMode = result.current.mode;
        act(() => {
            result.current.toggle();
        });
        expect(result.current.mode).not.toBe(initialMode);
    });

    it('setMode explicitly sets to dark', () => {
        localStorage.removeItem('atlas.themeMode');
        const { result } = renderHook(() => useThemeModeContext(), {
            wrapper: ({ children }) => <ThemeModeProvider>{children}</ThemeModeProvider>,
        });
        act(() => {
            result.current.setMode('dark');
        });
        expect(result.current.mode).toBe('dark');
    });
});
