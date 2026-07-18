import { useCallback, useMemo, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';

// 2026-06-10 — Settings → Profile → Appearance toggle.
//
// Refined segmented-control aesthetic: two-position pill with sun + label
// on the left, moon + label on the right. The selection indicator is a
// single absolutely-positioned filled pill that animates between
// positions via `translateX`, giving a polished sliding state-swap.
//
// Accessibility: `role=radiogroup` with two `role=radio` children, full
// keyboard support (Enter/Space activates; ←/→ moves focus + selection
// across options to match the WAI-ARIA radiogroup pattern).

const SEGMENT_WIDTH = 96; // px — fixed so each option has the same hit area
const SEGMENT_HEIGHT = 36; // px

interface SegmentDef {
    value: 'light' | 'dark';
    label: string;
    Icon: typeof LightModeRounded;
}

const SEGMENTS: ReadonlyArray<SegmentDef> = [
    { value: 'light', label: 'Light', Icon: LightModeRounded },
    { value: 'dark', label: 'Dark', Icon: DarkModeRounded },
];

export function ThemeModeToggle() {
    const { mode, setMode } = useThemeModeContext();
    const activeIndex = useMemo(() => SEGMENTS.findIndex((s) => s.value === mode), [mode]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>, idx: number) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMode(SEGMENTS[idx]!.value);
                return;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = SEGMENTS[(idx - 1 + SEGMENTS.length) % SEGMENTS.length]!;
                setMode(prev.value);
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const next = SEGMENTS[(idx + 1) % SEGMENTS.length]!;
                setMode(next.value);
                return;
            }
        },
        [setMode],
    );

    return (
        <Box
            role="radiogroup"
            aria-label="Theme mode"
            sx={{
                display: 'inline-flex',
                position: 'relative',
                p: '4px',
                gap: '4px',
                borderRadius: 999,
                border: `1px solid ${ATLAS_PALETTE.slate12}`,
                bgcolor: ATLAS_PALETTE.slate06,
                boxShadow: 'var(--atlas-elevation-low)',
                width: 'fit-content',
            }}
        >
            {/* Sliding active-segment fill. Sits behind the labels via z-index.
                `translateX(N * width)` slides between positions; the transition
                does the rest of the work. */}
            <Box
                aria-hidden
                sx={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    width: `${SEGMENT_WIDTH}px`,
                    height: `${SEGMENT_HEIGHT}px`,
                    borderRadius: 999,
                    background: ATLAS_PALETTE.slate,
                    boxShadow: 'var(--atlas-elevation-low)',
                    transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: `translateX(${activeIndex * (SEGMENT_WIDTH + 4)}px)`,
                    zIndex: 0,
                }}
            />
            {SEGMENTS.map(({ value, label, Icon }, idx) => {
                const isActive = mode === value;
                return (
                    <Box
                        key={value}
                        role="radio"
                        aria-checked={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => setMode(value)}
                        onKeyDown={(e) => handleKeyDown(e, idx)}
                        sx={{
                            position: 'relative',
                            zIndex: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            width: `${SEGMENT_WIDTH}px`,
                            height: `${SEGMENT_HEIGHT}px`,
                            borderRadius: 999,
                            cursor: 'pointer',
                            userSelect: 'none',
                            fontSize: 13,
                            fontWeight: 600,
                            color: isActive ? ATLAS_PALETTE.onAccent : ATLAS_PALETTE.slate60,
                            transition:
                                'color 220ms cubic-bezier(0.4, 0, 0.2, 1), transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                            '&:hover': isActive ? {} : { color: ATLAS_PALETTE.slate },
                            '&:focus-visible': {
                                // Subtle ring on keyboard focus only; mouse clicks
                                // don't keep the focus ring per :focus-visible.
                                outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                                outlineOffset: 2,
                            },
                        }}
                    >
                        <Icon sx={{ fontSize: 18 }} />
                        {label}
                    </Box>
                );
            })}
        </Box>
    );
}
