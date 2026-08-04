// Atlas Design System — Design Tokens (Mercury theme)
// Source of truth for all spacing, elevation, motion, and color values.
// Always use these tokens. Never hardcode values in components.
//
// 2026-06-10 — Mercury monochrome theme. Slot names from the previous
// "Atlas" palette are preserved (green/brandBlue/cerulean/...) so
// components don't need to change — but their *values* are now Mercury
// neutrals + functional status colours. See `newtheme.md` for the spec.
//
// The active value flips with `document.documentElement[data-theme]` —
// no component touch required. CSS values live in `theme-vars.css`
// (single source of truth for both modes); `applyThemeVars(mode)` only
// flips the `data-theme` attribute so the right CSS block applies.
//
// `createAtlasTheme(mode)` in `theme.ts` reads the raw hex directly
// from ATLAS_LIGHT / ATLAS_DARK below because MUI needs concrete
// colors for alpha/contrast manipulations the CSS engine can't do.

// =====================================================================
// Raw hex values per mode — single source of truth for both modes
// =====================================================================

export const ATLAS_LIGHT = {
    // Brand-hue slots — all collapse to Mercury accent (= text).
    // `greenDark` deliberately deviates from `green` so the ~25 primary
    // buttons across the app that use `&:hover: { bgcolor: greenDark }`
    // produce a visible hover state. Mercury "lifts" a near-black surface
    // toward a neutral gray on hover rather than darkening it further.
    green: '#4F46E5',
    greenDark: '#4338CA',
    emerald: '#4F46E5',
    brandBlue: '#4F46E5',
    cerulean: '#4F46E5',
    eggplant: '#4F46E5',
    purple: '#4F46E5',
    fuchsia: '#4F46E5',
    // Warm-hue slots → Mercury warn.
    orange: '#A86A1F',
    gold: '#A86A1F',
    // Core neutrals.
    slate: '#0A0A0A',
    navy: '#F4F4F4', // sidenav recessed surface in Mercury · Light
    cloud: '#F0F0F0', // surface-2
    white: '#FFFFFF',
    pageBg: '#F8F8FC',
    surfaceRaised: '#FFFFFF',
    // Alpha ladder — rebased on Mercury text (10,10,10) channel.
    slate80: 'rgba(10,10,10,.8)',
    slate70: 'rgba(10,10,10,.7)',
    slate60: 'rgba(10,10,10,.6)',
    slate40: 'rgba(10,10,10,.6)',
    slate30: 'rgba(10,10,10,.3)',
    slate12: 'rgba(10,10,10,.12)',
    slate10: 'rgba(10,10,10,.1)',
    slate08: 'rgba(10,10,10,.08)',
    slate06: 'rgba(10,10,10,.06)',
    // Functional status. `success` was darkened from #2D7A4A to #46A56A
    // so the live/ripple green doesn't read as forest in light theme.
    success: '#46A56A',
    warning: '#A86A1F',
    error: '#B33A30',
    info: '#4F46E5', // info reads as accent in Mercury
    // Backward-compat aliases (now collapsed to Mercury neutrals/status).
    cyanAccent: '#4F46E5',
    amber: '#A86A1F',
    rose: '#4F46E5',
    violet: '#4F46E5',
    teal: '#4F46E5',
    steel: 'rgba(10,10,10,.6)',
    mist: 'rgba(10,10,10,.4)',
    navyLight: '#F0F0F0',
    brandBlueDark: '#4338CA',
    brandBlueLight: '#6366F1',
    brown: '#A86A1F',
    red: '#B33A30',
    /** Foreground colour on accent-coloured chips/buttons. White in light
     * mode (white text on black accent); dark in dark mode (black text on
     * white accent). */
    onAccent: '#FFFFFF',
    /** Hero banner stops — deep neutral pair (banners use white text). */
    heroGradientStart: '#4F46E5',
    heroGradientEnd: '#3730A3',
    // Mercury sidenav scale.
    sideBg: '#F4F4F4',
    sideBorder: '#E0E0E0',
    sideText: '#4A4A4A',
    sideTextStrong: '#0A0A0A',
    sideMuted: '#888888',
    sideActiveBg: '#EDEEFB',
    sideInfoBg: '#F0F0F0',
    sideInfoBorder: '#E0E0E0',
    // Mercury accent / status soft + fg.
    accentSoft: '#ECEEFB',
    accentFg: '#4338CA',
    successSoft: '#E1ECE5',
    successFg: '#1F5734',
    warnSoft: '#F0E4CC',
    warnFg: '#6F4513',
    dangerSoft: '#F0D5D1',
    dangerFg: '#7A2A22',
    // Terminal surface — always-dark log viewer (identical in both
    // ATLAS_LIGHT and ATLAS_DARK; theme-vars.css mirrors the values).
    // A token that *flips* (e.g. slate) breaks terminals in dark mode.
    terminalBg: '#0A0A0A',
    terminalFgOk: '#A3F7BF',
    terminalFgErr: '#FFB3B3',
    // Diff viewer (Stop-session review). Two tiers per side: the row tier is
    // a full-bleed background that must keep `slate` body text readable; the
    // word tier is the intra-line highlight and must out-read the row it sits
    // on. successSoft/dangerSoft are chip fills tuned against successFg /
    // dangerFg, so they can't serve either role here.
    diffAddBg: '#E6F4EA',
    diffDelBg: '#FCE8E6',
    diffAddWord: '#ABE5BC',
    diffDelWord: '#F5B6B0',
    diffGutterBg: '#F6F6F8',
    diffGutterFg: '#8A8A93',
    diffFillerBg: '#F2F2F4',
    diffHunkBg: '#EEF0FA',
    diffHunkFg: '#5B5FA8',
    diffTokKeyword: '#7C3AED',
    diffTokString: '#0F766E',
    diffTokComment: '#6B7280',
    diffTokNumber: '#B45309',
    diffTokPunct: '#6B7280',
} as const;

export const ATLAS_DARK = {
    green: '#818CF8',
    greenDark: '#A5B4FC',
    emerald: '#818CF8',
    brandBlue: '#818CF8',
    cerulean: '#818CF8',
    eggplant: '#818CF8',
    purple: '#818CF8',
    fuchsia: '#818CF8',
    orange: '#FBBF24',
    gold: '#FBBF24',
    slate: '#FAFAFA',
    navy: '#050505',
    cloud: '#1F1F1F',
    white: '#161616',
    pageBg: '#0A0A0F',
    surfaceRaised: '#1F1F1F',
    slate80: 'rgba(250,250,250,.8)',
    slate70: 'rgba(250,250,250,.7)',
    slate60: 'rgba(250,250,250,.6)',
    slate40: 'rgba(250,250,250,.6)',
    slate30: 'rgba(250,250,250,.3)',
    slate12: 'rgba(250,250,250,.12)',
    slate10: 'rgba(250,250,250,.1)',
    slate08: 'rgba(250,250,250,.08)',
    slate06: 'rgba(250,250,250,.06)',
    success: '#4ADE80',
    warning: '#FBBF24',
    error: '#F87171',
    info: '#818CF8',
    cyanAccent: '#818CF8',
    amber: '#FBBF24',
    rose: '#818CF8',
    violet: '#818CF8',
    teal: '#818CF8',
    steel: 'rgba(250,250,250,.6)',
    mist: 'rgba(250,250,250,.4)',
    navyLight: '#1F1F1F',
    brandBlueDark: '#6366F1',
    brandBlueLight: '#A5B4FC',
    brown: '#FBBF24',
    red: '#F87171',
    onAccent: '#0A0A0A',
    heroGradientStart: '#4F46E5',
    heroGradientEnd: '#3730A3',
    sideBg: '#050505',
    sideBorder: '#1F1F1F',
    sideText: '#A8A8A8',
    sideTextStrong: '#FAFAFA',
    sideMuted: '#5C5C5C',
    sideActiveBg: '#232152',
    sideInfoBg: '#161616',
    sideInfoBorder: '#2A2A2A',
    accentSoft: '#232152',
    accentFg: '#A5B4FC',
    successSoft: '#14281A',
    successFg: '#86EFAC',
    warnSoft: '#2A1F08',
    warnFg: '#FCD34D',
    dangerSoft: '#2A1414',
    dangerFg: '#FCA5A5',
    // Terminal surface — same values as ATLAS_LIGHT (intentional).
    terminalBg: '#0A0A0A',
    terminalFgOk: '#A3F7BF',
    terminalFgErr: '#FFB3B3',
    // Diff viewer — dark counterparts. Same two-tier rule as ATLAS_LIGHT.
    diffAddBg: '#12251A',
    diffDelBg: '#2A1618',
    diffAddWord: '#1E5233',
    diffDelWord: '#6B2822',
    diffGutterBg: '#141414',
    diffGutterFg: '#6E6E76',
    diffFillerBg: '#111111',
    diffHunkBg: '#191B33',
    diffHunkFg: '#9BA1E8',
    diffTokKeyword: '#C4B5FD',
    diffTokString: '#5EEAD4',
    diffTokComment: '#8B93A1',
    diffTokNumber: '#FBBF24',
    diffTokPunct: '#9CA3AF',
} as const;

// =====================================================================
// ATLAS_PALETTE — CSS variable references (theme-aware at paint time)
// =====================================================================

export const ATLAS_PALETTE = {
    green: 'var(--atlas-green)',
    greenDark: 'var(--atlas-greenDark)',
    emerald: 'var(--atlas-emerald)',
    brandBlue: 'var(--atlas-brandBlue)',
    cerulean: 'var(--atlas-cerulean)',
    eggplant: 'var(--atlas-eggplant)',
    purple: 'var(--atlas-purple)',
    orange: 'var(--atlas-orange)',
    gold: 'var(--atlas-gold)',
    fuchsia: 'var(--atlas-fuchsia)',
    slate: 'var(--atlas-slate)',
    navy: 'var(--atlas-navy)',
    cloud: 'var(--atlas-cloud)',
    white: 'var(--atlas-white)',
    pageBg: 'var(--atlas-pageBg)',
    surfaceRaised: 'var(--atlas-surfaceRaised)',
    slate80: 'var(--atlas-slate80)',
    slate70: 'var(--atlas-slate70)',
    slate60: 'var(--atlas-slate60)',
    slate40: 'var(--atlas-slate40)',
    slate30: 'var(--atlas-slate30)',
    slate12: 'var(--atlas-slate12)',
    slate10: 'var(--atlas-slate10)',
    slate08: 'var(--atlas-slate08)',
    slate06: 'var(--atlas-slate06)',
    success: 'var(--atlas-success)',
    warning: 'var(--atlas-warning)',
    error: 'var(--atlas-error)',
    info: 'var(--atlas-info)',
    cyanAccent: 'var(--atlas-cyanAccent)',
    amber: 'var(--atlas-amber)',
    rose: 'var(--atlas-rose)',
    violet: 'var(--atlas-violet)',
    teal: 'var(--atlas-teal)',
    steel: 'var(--atlas-steel)',
    mist: 'var(--atlas-mist)',
    navyLight: 'var(--atlas-navyLight)',
    brandBlueDark: 'var(--atlas-brandBlueDark)',
    brandBlueLight: 'var(--atlas-brandBlueLight)',
    brown: 'var(--atlas-brown)',
    red: 'var(--atlas-red)',
    onAccent: 'var(--atlas-onAccent)',
    heroGradientStart: 'var(--atlas-heroGradientStart)',
    heroGradientEnd: 'var(--atlas-heroGradientEnd)',
    sideBg: 'var(--atlas-sideBg)',
    sideBorder: 'var(--atlas-sideBorder)',
    sideText: 'var(--atlas-sideText)',
    sideTextStrong: 'var(--atlas-sideTextStrong)',
    sideMuted: 'var(--atlas-sideMuted)',
    sideActiveBg: 'var(--atlas-sideActiveBg)',
    sideInfoBg: 'var(--atlas-sideInfoBg)',
    sideInfoBorder: 'var(--atlas-sideInfoBorder)',
    accentSoft: 'var(--atlas-accentSoft)',
    accentFg: 'var(--atlas-accentFg)',
    successSoft: 'var(--atlas-successSoft)',
    successFg: 'var(--atlas-successFg)',
    warnSoft: 'var(--atlas-warnSoft)',
    warnFg: 'var(--atlas-warnFg)',
    dangerSoft: 'var(--atlas-dangerSoft)',
    dangerFg: 'var(--atlas-dangerFg)',
    terminalBg: 'var(--atlas-terminalBg)',
    terminalFgOk: 'var(--atlas-terminalFgOk)',
    terminalFgErr: 'var(--atlas-terminalFgErr)',
    diffAddBg: 'var(--atlas-diffAddBg)',
    diffDelBg: 'var(--atlas-diffDelBg)',
    diffAddWord: 'var(--atlas-diffAddWord)',
    diffDelWord: 'var(--atlas-diffDelWord)',
    diffGutterBg: 'var(--atlas-diffGutterBg)',
    diffGutterFg: 'var(--atlas-diffGutterFg)',
    diffFillerBg: 'var(--atlas-diffFillerBg)',
    diffHunkBg: 'var(--atlas-diffHunkBg)',
    diffHunkFg: 'var(--atlas-diffHunkFg)',
    diffTokKeyword: 'var(--atlas-diffTokKeyword)',
    diffTokString: 'var(--atlas-diffTokString)',
    diffTokComment: 'var(--atlas-diffTokComment)',
    diffTokNumber: 'var(--atlas-diffTokNumber)',
    diffTokPunct: 'var(--atlas-diffTokPunct)',
} as const;

export const ELEVATION = {
    flat: 'none',
    low: 'var(--atlas-elevation-low)',
    mid: 'var(--atlas-elevation-mid)',
    high: 'var(--atlas-elevation-high)',
    overlay: 'var(--atlas-elevation-overlay)',
} as const;

export const MOTION = {
    micro: 100,
    hover: 150,
    dropdown: 180,
    modal: 250,
    page: 400,
} as const;

export const MOTION_EASING = {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const TOUCH = {
    rowMin: 56,
    iconButton: 40,
    cta: 44,
} as const;

export const MOBILE_SHELL = {
    appBarHeight: 56,
    bottomNavHeight: 56,
    fabBottomOffset: 80,
} as const;

export interface StatusPaletteEntry {
    label: string;
    /** Pale chip fill (used by `StatusChip` / `StatusPill`). */
    bg: string;
    /** Deep tonal text colour on top of the chip. */
    fg: string;
    /**
     * Mid-saturation hue for small standalone dots (status-picker dropdown,
     * kanban column header). A pale `.bg` blob with a deep `.fg` border
     * read as wishy-washy at 8–10px; a single mid-tone reads as "the blue
     * dot" / "the green dot" cleanly on both light and dark canvases.
     */
    dot: string;
}

// Each status owns three tones: light pastel `bg`, deep tonal `fg`,
// mid-saturation `dot`. Same CSS-var lookup pattern across all three so
// every consumer renders against the theme variables.
export const STATUS_PALETTE: Record<string, StatusPaletteEntry> = {
    draft: {
        label: 'Draft',
        bg: 'var(--atlas-status-draft-bg)',
        fg: 'var(--atlas-status-draft-fg)',
        dot: 'var(--atlas-status-draft-dot)',
    },
    ready: {
        label: 'Ready',
        bg: 'var(--atlas-status-ready-bg)',
        fg: 'var(--atlas-status-ready-fg)',
        dot: 'var(--atlas-status-ready-dot)',
    },
    in_progress: {
        label: 'In Progress',
        bg: 'var(--atlas-status-in_progress-bg)',
        fg: 'var(--atlas-status-in_progress-fg)',
        dot: 'var(--atlas-status-in_progress-dot)',
    },
    waiting_for_info: {
        label: 'Waiting for Info',
        bg: 'var(--atlas-status-waiting_for_info-bg)',
        fg: 'var(--atlas-status-waiting_for_info-fg)',
        dot: 'var(--atlas-status-waiting_for_info-dot)',
    },
    in_review: {
        label: 'In Review',
        bg: 'var(--atlas-status-in_review-bg)',
        fg: 'var(--atlas-status-in_review-fg)',
        dot: 'var(--atlas-status-in_review-dot)',
    },
    done: {
        label: 'Done',
        bg: 'var(--atlas-status-done-bg)',
        fg: 'var(--atlas-status-done-fg)',
        dot: 'var(--atlas-status-done-dot)',
    },
};

export const DEFAULT_STATUS_PALETTE_ENTRY: StatusPaletteEntry = {
    label: '',
    bg: 'var(--atlas-status-draft-bg)',
    fg: 'var(--atlas-status-draft-fg)',
    dot: 'var(--atlas-status-draft-dot)',
};

export const TYPOGRAPHY = {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontFamilyMono: '"JetBrains Mono", ui-monospace, monospace',
    h1: { fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.2 },
    h2: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 },
    h3: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    body1: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.6 },
    body2: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.6 },
    caption: { fontSize: '0.6875rem', fontWeight: 400, lineHeight: 1.5 },
    label: {
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase' as const,
    },
    mono: { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: '0.8125rem' },
} as const;

// =====================================================================
// LABEL_COLORS — 10-colour palette for user-assigned labels.
// Consolidated source (was duplicated in LabelsRailRow + LabelsFormField).
// Mercury allows colour for user content; each colour has light + dark pair.
// =====================================================================

export interface LabelColorPair {
    bg: string;
    fg: string;
    border: string;
}

export interface LabelColorEntry {
    light: LabelColorPair;
    dark: LabelColorPair;
}

export const LABEL_COLORS = {
    slate: {
        light: { bg: '#F1F5F9', fg: '#0F172A', border: '#CBD5E1' },
        dark: { bg: '#1F2937', fg: '#E2E8F0', border: '#475569' },
    },
    sky: {
        light: { bg: '#E0F2FE', fg: '#0C4A6E', border: '#7DD3FC' },
        dark: { bg: '#0C2A3F', fg: '#BAE6FD', border: '#0369A1' },
    },
    indigo: {
        light: { bg: '#E0E7FF', fg: '#312E81', border: '#A5B4FC' },
        dark: { bg: '#1E1B4B', fg: '#C7D2FE', border: '#4338CA' },
    },
    violet: {
        light: { bg: '#EDE9FE', fg: '#4C1D95', border: '#C4B5FD' },
        dark: { bg: '#2E1065', fg: '#DDD6FE', border: '#6D28D9' },
    },
    pink: {
        light: { bg: '#FCE7F3', fg: '#831843', border: '#F9A8D4' },
        dark: { bg: '#500724', fg: '#FBCFE8', border: '#9D174D' },
    },
    rose: {
        light: { bg: '#FFE4E6', fg: '#881337', border: '#FDA4AF' },
        dark: { bg: '#4C0519', fg: '#FECDD3', border: '#9F1239' },
    },
    amber: {
        light: { bg: '#FEF3C7', fg: '#78350F', border: '#FCD34D' },
        dark: { bg: '#451A03', fg: '#FDE68A', border: '#92400E' },
    },
    yellow: {
        light: { bg: '#FEF9C3', fg: '#713F12', border: '#FDE047' },
        dark: { bg: '#422006', fg: '#FEF08A', border: '#854D0E' },
    },
    emerald: {
        light: { bg: '#D1FAE5', fg: '#064E3B', border: '#6EE7B7' },
        dark: { bg: '#022C22', fg: '#A7F3D0', border: '#047857' },
    },
    teal: {
        light: { bg: '#CCFBF1', fg: '#134E4A', border: '#5EEAD4' },
        dark: { bg: '#042F2E', fg: '#99F6E4', border: '#0F766E' },
    },
} as const;

export type LabelColorKey = keyof typeof LABEL_COLORS;
