import { useMemo, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { createAtlasTheme } from '../theme/theme.js';
import { useThemeMode } from '../hooks/useThemeMode.js';
import {
    ThemeModeContext,
    type ThemeModeContextValue,
} from '../hooks/useThemeModeContext.js';

// 2026-06-10 — Combined theme-state + MUI ThemeProvider wrapper.
// Consumes `useThemeMode` for state + persistence, rebuilds the MUI theme
// on every mode change via `createAtlasTheme(mode)`, and exposes the
// current mode + setter to descendants via `ThemeModeContext`. The hook
// itself (`useThemeModeContext`) lives in `hooks/useThemeModeContext.ts`
// so this file stays component-only and Vite Fast Refresh works cleanly.

export function ThemeModeProvider({ children }: { children: ReactNode }) {
    const { mode, setMode } = useThemeMode();

    const muiTheme = useMemo(() => createAtlasTheme(mode), [mode]);

    const ctxValue = useMemo<ThemeModeContextValue>(
        () => ({
            mode,
            setMode,
            toggle: () => setMode(mode === 'light' ? 'dark' : 'light'),
        }),
        [mode, setMode],
    );

    return (
        <ThemeModeContext.Provider value={ctxValue}>
            <ThemeProvider theme={muiTheme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ThemeModeContext.Provider>
    );
}
