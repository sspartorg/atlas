import { createTheme, type Theme } from '@mui/material/styles';
import {
    ATLAS_PALETTE,
    ATLAS_LIGHT,
    ATLAS_DARK,
    MOTION,
    MOTION_EASING,
} from './tokens.js';

declare module '@mui/material/styles' {
    interface Palette {
        atlas: typeof ATLAS_PALETTE;
    }
    interface PaletteOptions {
        atlas?: Partial<typeof ATLAS_PALETTE>;
    }
}

// ATLAS_PALETTE holds CSS vars, so one ring reads in light and dark.
const FOCUS_RING = { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: 2 };

export type ThemeMode = 'light' | 'dark';

export function createAtlasTheme(mode: ThemeMode): Theme {
    const raw = mode === 'dark' ? ATLAS_DARK : ATLAS_LIGHT;

    return createTheme({
        palette: {
            mode,
            primary: {
                main: raw.green,
                dark: raw.greenDark,
                contrastText: raw.onAccent,
            },
            secondary: {
                main: raw.brandBlue,
                contrastText: raw.onAccent,
            },
            background: {
                default: raw.pageBg,
                paper: raw.white,
            },
            text: {
                primary: raw.slate,
                secondary: raw.slate60,
                disabled: raw.slate40,
            },
            error: { main: raw.error },
            warning: { main: raw.orange },
            success: { main: raw.success },
            info: { main: raw.brandBlue },
            divider: raw.slate08,
            atlas: ATLAS_PALETTE,
        },

        typography: {
            fontFamily: '"Inter", system-ui, sans-serif',
            h1: { fontWeight: 700, fontSize: '2.25rem', lineHeight: 1.2, letterSpacing: '-.01em' },
            h2: { fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.3 },
            h3: { fontWeight: 600, fontSize: '1rem', lineHeight: 1.4 },
            h4: { fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.4 },
            h5: { fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.4 },
            h6: { fontWeight: 600, fontSize: '0.75rem', lineHeight: 1.4 },
            body1: { fontSize: '0.875rem', lineHeight: 1.6 },
            body2: { fontSize: '0.75rem', lineHeight: 1.6 },
            caption: { fontSize: '0.6875rem', lineHeight: 1.5 },
            overline: {
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
            },
            button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.01em' },
        },

        shape: { borderRadius: 8 },
        spacing: 4,

        transitions: {
            duration: {
                shortest: MOTION.micro,
                shorter: MOTION.hover,
                short: MOTION.dropdown,
                standard: MOTION.modal,
                complex: MOTION.page,
                enteringScreen: MOTION.modal,
                leavingScreen: MOTION.dropdown,
            },
            easing: {
                easeIn: MOTION_EASING.accelerate,
                easeOut: MOTION_EASING.decelerate,
                easeInOut: MOTION_EASING.standard,
                sharp: MOTION_EASING.standard,
            },
        },

        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    '*': {
                        scrollbarWidth: 'thin',
                        scrollbarColor: `${ATLAS_PALETTE.slate30} transparent`,
                    },
                    '*::-webkit-scrollbar': { width: 6, height: 6 },
                    '*::-webkit-scrollbar-thumb': {
                        background: ATLAS_PALETTE.slate30,
                        borderRadius: 3,
                    },
                    '*::-webkit-scrollbar-track': { background: 'transparent' },
                    '::selection': { background: `${raw.brandBlue}26` },
                    // JetBrains Mono's code ligatures (contextual alternates)
                    // redraw "!=" as "≠" and close up "//" in URLs, paths, JQL
                    // and branch names; literal text must read as typed.
                    body: { fontVariantLigatures: 'no-contextual' },
                    '*:focus': { outline: 'none' },
                    // Keyboard focus must be visible (WCAG 2.4.7). Text fields
                    // show their own focused border; tabindex=-1 targets
                    // (dialog paper, tab panels) take focus programmatically.
                    '*:focus-visible': FOCUS_RING,
                    ':is(input, textarea, select, [contenteditable], [tabindex="-1"]):focus-visible': {
                        outline: 'none',
                    },
                    code: { fontFamily: '"JetBrains Mono", monospace' },
                    pre: { fontFamily: '"JetBrains Mono", monospace' },
                    '@media (max-width: 600px)': {
                        'input, select, textarea, .MuiInputBase-input': {
                            fontSize: '16px !important',
                        },
                    },
                },
            },

            // ButtonBase resets outline itself and marks keyboard focus
            // with .Mui-focusVisible, so the ring goes there too.
            MuiButtonBase: {
                styleOverrides: { root: { '&.Mui-focusVisible': FOCUS_RING } },
            },

            MuiButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 6,
                        padding: '7px 16px',
                        fontWeight: 500,
                        fontSize: '0.8125rem',
                        height: 36,
                    },
                    contained: {
                        background: ATLAS_PALETTE.green,
                        color: ATLAS_PALETTE.onAccent,
                        boxShadow: 'none',
                        '&:hover': {
                            background: ATLAS_PALETTE.greenDark,
                            boxShadow: 'none',
                        },
                    },
                    outlined: {
                        borderColor: ATLAS_PALETTE.slate12,
                        color: ATLAS_PALETTE.slate,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.slate30,
                            background: ATLAS_PALETTE.slate08,
                        },
                    },
                    text: {
                        color: ATLAS_PALETTE.slate,
                        '&:hover': { background: ATLAS_PALETTE.slate08 },
                    },
                },
            },

            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'none',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    },
                },
            },

            MuiCard: {
                styleOverrides: {
                    root: {
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        boxShadow: 'var(--atlas-elevation-low)',
                        backgroundImage: 'none',
                    },
                },
            },

            MuiChip: {
                styleOverrides: {
                    root: {
                        borderRadius: 6,
                        fontWeight: 500,
                        fontSize: '0.75rem',
                    },
                },
            },

            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        background: ATLAS_PALETTE.slate,
                        color: raw.pageBg,
                        fontSize: '0.75rem',
                        fontFamily: '"Inter", system-ui, sans-serif',
                    },
                    arrow: { color: ATLAS_PALETTE.slate },
                },
            },

            MuiListItemButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 8,
                        '&.Mui-selected': {
                            background: `${raw.brandBlue}14`,
                            '&:hover': { background: `${raw.brandBlue}1E` },
                        },
                        '&:hover': { background: ATLAS_PALETTE.slate08 },
                    },
                },
            },

            MuiDivider: {
                styleOverrides: {
                    root: { borderColor: ATLAS_PALETTE.slate08 },
                },
            },

            MuiTab: {
                styleOverrides: {
                    root: {
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: '0.875rem',
                        minHeight: 44,
                        color: ATLAS_PALETTE.slate60,
                        '&.Mui-selected': { color: ATLAS_PALETTE.brandBlue },
                        // Inset: the tab scroller clips anything outside.
                        '&.Mui-focusVisible': { outlineOffset: -2 },
                    },
                },
            },

            MuiTabs: {
                styleOverrides: {
                    indicator: { background: ATLAS_PALETTE.brandBlue },
                },
            },

            MuiTextField: {
                defaultProps: {
                    variant: 'outlined',
                    size: 'small',
                    fullWidth: true,
                    autoComplete: 'off',
                },
                styleOverrides: {
                    root: {
                        '& .MuiOutlinedInput-root': {
                            '& fieldset': { borderColor: ATLAS_PALETTE.slate12 },
                            '&:hover fieldset': { borderColor: ATLAS_PALETTE.slate30 },
                            '&.Mui-focused fieldset': { borderColor: ATLAS_PALETTE.brandBlue },
                            '&.Mui-error fieldset': { borderColor: ATLAS_PALETTE.error },
                            '&.Mui-error:hover fieldset': { borderColor: ATLAS_PALETTE.error },
                            '&.Mui-error.Mui-focused fieldset': { borderColor: ATLAS_PALETTE.error },
                        },
                        '& .MuiInputLabel-root': { color: ATLAS_PALETTE.slate60 },
                    },
                },
            },

            MuiFormControl: {
                defaultProps: { variant: 'outlined', size: 'small', fullWidth: true },
            },

            MuiAutocomplete: {
                defaultProps: { size: 'small' },
            },

            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        '&:not(.MuiInputBase-multiline)': { height: 40 },
                    },
                    input: {
                        paddingTop: 0,
                        paddingBottom: 0,
                        height: 40,
                        boxSizing: 'border-box',
                    },
                },
            },

            MuiInputLabel: {
                styleOverrides: {
                    root: {
                        color: ATLAS_PALETTE.slate60,
                        '&.Mui-focused': { color: ATLAS_PALETTE.brandBlue },
                        '&.Mui-error': { color: ATLAS_PALETTE.error },
                        '&.Mui-error.Mui-focused': { color: ATLAS_PALETTE.error },
                    },
                },
            },

            MuiLinearProgress: {
                styleOverrides: {
                    root: { borderRadius: 4, background: ATLAS_PALETTE.slate08 },
                },
            },

            MuiSkeleton: {
                styleOverrides: {
                    root: { background: ATLAS_PALETTE.slate08 },
                },
            },

            MuiDialog: {
                styleOverrides: {
                    paper: {
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        boxShadow: 'var(--atlas-elevation-overlay)',
                    },
                },
            },

            MuiDialogTitle: {
                styleOverrides: {
                    root: { color: ATLAS_PALETTE.slate, fontWeight: 600 },
                },
            },

            MuiSelect: {
                defaultProps: { variant: 'outlined', size: 'small' },
                styleOverrides: {
                    root: {
                        '& .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.slate12,
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.slate30,
                        },
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                        },
                        '&.Mui-error .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.error,
                        },
                    },
                    select: {
                        display: 'flex',
                        alignItems: 'center',
                        paddingTop: 0,
                        paddingBottom: 0,
                        height: 40,
                        boxSizing: 'border-box',
                    },
                },
            },

            MuiMenuItem: {
                styleOverrides: {
                    root: {
                        color: ATLAS_PALETTE.slate,
                        '&:hover': { background: ATLAS_PALETTE.slate08 },
                        '&.Mui-selected': {
                            background: `${raw.brandBlue}14`,
                            color: ATLAS_PALETTE.brandBlue,
                        },
                        // Inset: the menu paper clips anything outside.
                        '&.Mui-focusVisible': { outlineOffset: -2 },
                    },
                },
            },
        },
    });
}


