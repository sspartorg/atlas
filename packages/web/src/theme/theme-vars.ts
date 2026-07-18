// 2026-06-10 — Runtime theme switcher.
//
// `theme-vars.css` is the single source of truth for every CSS variable
// in both `:root` (light) and `:root[data-theme="dark"]` blocks. This
// module's only job is to flip the `data-theme` attribute on
// `<html>` so the right CSS block applies.
//
// Earlier revisions also wrote each variable as an inline style on
// `document.documentElement` ("defence in depth"). That created a
// silent DX trap: inline styles outrank `:root` rules, so a CSS-file
// edit landed on disk but the stale inline value still painted —
// changes only appeared after a full reload, never via HMR. CSS
// variables are not affected by stacking contexts, so the inline
// override was solving a problem that never existed. Now removed.
//
// MUI's palette in `theme.ts::createAtlasTheme` still reads the raw
// hex from `tokens.ts::ATLAS_LIGHT/ATLAS_DARK` because MUI needs
// concrete colors for alpha/contrast computation. That path is
// independent from this one.

export type ThemeMode = 'light' | 'dark';

export function applyThemeVars(mode: ThemeMode): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
}
