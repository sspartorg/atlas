import { useCallback, useEffect, useState } from 'react';
import { applyThemeVars, type ThemeMode } from '../theme/theme-vars.js';

// 2026-06-10 — Theme-mode state + persistence.
//
// Reads the persisted mode from `localStorage` on mount; falls back to
// the OS `prefers-color-scheme` media query when no value is stored.
// Writes to `localStorage` on every change so the choice survives
// reloads forever.
//
// Cross-tab sync via the `storage` event mirrors the pattern in
// `useAgentFavorites.ts:22-26` so flipping the toggle in one tab updates
// any other open tab within ~50ms.
//
// Every mode change re-runs `applyThemeVars(mode)` to keep inline CSS
// variables on `document.documentElement` in sync. The CSS file
// (`theme-vars.css`) handles the boot path before this hook ever runs.

export type { ThemeMode } from '../theme/theme-vars.js';

const STORAGE_KEY = 'atlas.themeMode';

function readPersisted(): ThemeMode | null {
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'light' || v === 'dark') return v;
    } catch {
        // private-mode storage access, etc. — silently fall through.
    }
    return null;
}

function readInitialMode(): ThemeMode {
    const persisted = readPersisted();
    if (persisted) return persisted;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        } catch {
            // matchMedia not supported / throws — fall through.
        }
    }
    return 'light';
}

export interface UseThemeModeReturn {
    mode: ThemeMode;
    setMode: (next: ThemeMode) => void;
}

export function useThemeMode(): UseThemeModeReturn {
    // `useState`'s initialiser only runs once at mount, so the FOUC-prevention
    // script's `data-theme` attribute is already on the DOM by the time
    // React reads `readInitialMode()`. Both arrive at the same value.
    const [mode, setModeState] = useState<ThemeMode>(readInitialMode);

    // Apply on mount + every mode change. Even though the inline FOUC script
    // already set `data-theme`, we also write the per-property inline styles
    // here so `applyThemeVars(mode)` and the stylesheet agree.
    useEffect(() => {
        applyThemeVars(mode);
    }, [mode]);

    // Cross-tab sync.
    useEffect(() => {
        function handler(e: StorageEvent): void {
            if (e.key !== STORAGE_KEY) return;
            if (e.newValue === 'light' || e.newValue === 'dark') {
                setModeState(e.newValue);
            }
        }
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const setMode = useCallback((next: ThemeMode) => {
        try {
            window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Quota / private-mode — accept the runtime change anyway; the
            // user can re-pick next session.
        }
        setModeState(next);
    }, []);

    return { mode, setMode };
}
