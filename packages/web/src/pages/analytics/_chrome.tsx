import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';

// Shared chrome for the Analytics surface (overview + drill-down pages).
// Lifted out of Analytics.tsx so AnalyticsProject and AnalyticsEpic stay
// visually identical without dragging the whole 1300-line file along.
// Public surface: Card, Eyebrow, ChartTitle, MetricMarquee, MONO,
// CHART_COLORS, AGENT_RING.

export const MONO = TYPOGRAPHY.fontFamilyMono;

// Chart series palette — fixed mid-saturation colours picked to clear ~4.5:1
// contrast on BOTH the light page (#FAFAFA cream) and the dark page (#0A0A0A
// ink) without flipping per mode. Charts live in cards that change bg, but
// the strokes/fills are theme-independent visual cues. Picked from
// Tailwind's 500/400 family — modern, recognisable as analytics-grade.
export const CHART_COLORS = {
    cost: '#3B82F6',        // blue-500 — primary (agentic) cost line
    costSoft: 'rgba(59,130,246,.18)',
    input: '#A855F7',       // purple-500 — input tokens
    output: '#06B6D4',      // cyan-500  — output tokens
    cached: '#10B981',      // emerald-500 — cached / efficient
    runs: '#F59E0B',        // amber-500 — completed-run volume
    // Manual terminal sessions accent. Chosen orange-500 to contrast
    // sharply with the agentic blue while staying inside the Tailwind
    // 500/400 family the rest of CHART_COLORS lives in. Used in stacked
    // bars (Daily Trend / Monthly Ladder), the Hero source-split chip,
    // and the dedicated "Manual terminal sessions" card. The "manual /
    // user-driven" feel comes from being warm-side vs the analytical
    // cool palette around it.
    terminal: '#F97316',
    terminalSoft: 'rgba(249,115,22,.18)',
    grid: 'rgba(127,127,127,.16)',  // mid-gray, visible on both modes
    rail: 'rgba(127,127,127,.28)',
};

// Per-issue-type accents used by Top Runs, Project bars, etc. Five
// distinct colours that read in both modes without relying on the now-
// collapsed brand-hue palette.
export const ITEM_TYPE_COLORS: Record<
    'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug',
    string
> = {
    epic: '#3B82F6',        // blue   — strategic
    story: '#06B6D4',       // cyan   — feature
    bug: '#F43F5E',         // rose   — defect
    sub_task: '#10B981',    // emerald — task
    sub_bug: '#A855F7',     // purple — sub-defect
};

export const ITEM_TYPE_LABEL: Record<
    'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug',
    string
> = {
    epic: 'Epic',
    story: 'Story',
    bug: 'Bug',
    sub_task: 'Sub-task',
    sub_bug: 'Sub-bug',
};

export function Eyebrow({
    children,
    light,
}: {
    children: ReactNode;
    light?: boolean;
}) {
    return (
        <Typography
            sx={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: light ? 'rgba(255,255,255,.62)' : ATLAS_PALETTE.slate40,
            }}
        >
            {children}
        </Typography>
    );
}

export function Card({
    children,
    sx,
}: {
    children: ReactNode;
    sx?: Parameters<typeof Box>[0]['sx'];
}) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '14px',
                p: 4,
                transition:
                    'border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease',
                '&:hover': {
                    borderColor: ATLAS_PALETTE.slate30,
                    boxShadow: 'var(--atlas-elevation-mid)',
                },
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}

// MetricMarquee always renders inside the dark Hero band — so every colour
// here is fixed-light rather than tied to the mode-flipping `ATLAS_PALETTE.*`
// tokens. Previously `color: ATLAS_PALETTE.white` (= `#161616` in dark) was
// painting the big metric values invisible on the dark hero.
export function MetricMarquee({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: ReactNode;
    sub?: ReactNode;
    accent: string;
}) {
    return (
        <Box sx={{ pl: 2.5, borderLeft: `2px solid ${accent}`, minWidth: 0 }}>
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,.65)',
                    fontWeight: 600,
                }}
            >
                {label}
            </Typography>
            <Typography
                sx={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    mt: 0.5,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </Typography>
            {sub && (
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: 'rgba(255,255,255,.65)',
                        mt: 0.5,
                    }}
                >
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

// Empty-state slot rendered inside a Card body when the chart has no
// data to display. Keeps every analytics card a uniform height (~200 min)
// so the 2-col grid doesn't collapse when one half is data-empty.
export function ChartEmpty({ label, sub }: { label: string; sub: string }) {
    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                py: 6,
                px: 2,
                border: `1px dashed ${ATLAS_PALETTE.slate10}`,
                borderRadius: '10px',
                minHeight: 200,
            }}
        >
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate40,
                    fontWeight: 600,
                }}
            >
                — {label} —
            </Typography>
            <Typography
                sx={{
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                    textAlign: 'center',
                    maxWidth: 320,
                    lineHeight: 1.55,
                }}
            >
                {sub}
            </Typography>
        </Box>
    );
}

export function ChartTitle({
    eyebrow,
    title,
    sub,
}: {
    eyebrow: string;
    title: string;
    sub?: string;
}) {
    return (
        <Box sx={{ mb: 3 }}>
            <Eyebrow>{eyebrow}</Eyebrow>
            <Typography
                sx={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    mt: 0.5,
                    lineHeight: 1.25,
                    letterSpacing: '-0.005em',
                }}
            >
                {title}
            </Typography>
            {sub && (
                <Typography
                    sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                >
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

// Hero band — dark slate background carrying the page identity + the
// big-number marquees. Used by both drill-down pages so they read as
// continuations of the Analytics Command Deck rather than ad-hoc views.
export function Hero({
    breadcrumb,
    title,
    sub,
    children,
}: {
    breadcrumb: ReactNode;
    title: ReactNode;
    sub?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Box
            sx={{
                background: `linear-gradient(135deg, ${ATLAS_PALETTE.heroGradientStart} 0%, ${ATLAS_PALETTE.heroGradientEnd} 100%)`,
                borderRadius: '18px',
                color: '#FFFFFF',
                p: { xs: 3, md: 5 },
                mb: 4,
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {breadcrumb}
            </Box>
            <Typography
                sx={{
                    fontSize: { xs: 22, md: 28 },
                    fontWeight: 700,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.15,
                    color: '#FFFFFF',
                }}
            >
                {title}
            </Typography>
            {sub && (
                <Typography
                    sx={{
                        fontFamily: MONO,
                        fontSize: 12,
                        color: 'rgba(255,255,255,.55)',
                        mt: 1,
                    }}
                >
                    {sub}
                </Typography>
            )}
            <Box
                sx={{
                    mt: 3,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                    gap: { xs: 2, md: 4 },
                }}
            >
                {children}
            </Box>
        </Box>
    );
}
