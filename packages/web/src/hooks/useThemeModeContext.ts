import { createContext, useContext } from 'react';
import type { ThemeMode } from './useThemeMode.js';

export interface ThemeModeContextValue {
    mode: ThemeMode;
    setMode: (m: ThemeMode) => void;
    toggle: () => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeModeContext(): ThemeModeContextValue {
    const v = useContext(ThemeModeContext);
    if (!v) {
        throw new Error('useThemeModeContext must be used inside <ThemeModeProvider>');
    }
    return v;
}
