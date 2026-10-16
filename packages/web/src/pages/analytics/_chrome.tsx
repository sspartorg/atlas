import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { AnalyticsWindow, IssueType } from '@atlas/shared';
import { ATLAS_PALETTE, CHART_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { formatSpan } from '../../utils/time.js';

// Shared chrome for the Analytics surface (tabs + drill-down pages).
// Every colour is a theme token, so the whole surface follows light and dark
// like the rest of the app — no always-dark band.

export const MONO = TYPOGRAPHY.fontFamilyMono;

/** Chart series colours live in `theme/tokens.ts` (CHART_PALETTE); this is the analytics alias. */
export const CHART_COLORS = CHART_PALETTE;

export const ITEM_TYPE_COLORS: Record<IssueType, string> = {
    task: CHART_PALETTE.task,
    sub_task: CHART_PALETTE.subTask,
};

export const ITEM_TYPE_LABEL: Record<IssueType, string> = {
    task: 'Task',
    sub_task: 'Sub-task',
};

/** `light` is accepted for older call sites; the colour is themed either way. */
export function Eyebrow({ children }: { children: ReactNode; light?: boolean }) {
    return (
        <Typography
            sx={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: ATLAS_PALETTE.slate60,
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
                p: { xs: 2.5, md: 4 },
                minWidth: 0,
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}

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
        <Box sx={{ pl: 2, borderLeft: `2px solid ${accent}`, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, fontWeight: 500 }}>{label}</Typography>
            <Typography
                sx={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    mt: 0.5,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </Typography>
            {sub && (
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>{sub}</Typography>
            )}
        </Box>
    );
}

// Empty-state slot rendered inside a Card body when the chart has no
// data to display. Keeps every analytics card a uniform minimum height.
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
                border: `1px dashed ${ATLAS_PALETTE.slate12}`,
                borderRadius: '10px',
                minHeight: 200,
            }}
        >
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate80 }}>{label}</Typography>
            <Typography
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate60,
                    textAlign: 'center',
                    maxWidth: 340,
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
    eyebrow?: string;
    title: string;
    /** For a metric, the definition: what is counted, from when to when. */
    sub?: ReactNode;
}) {
    return (
        <Box sx={{ mb: 2.5 }}>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <Typography
                component="h3"
                sx={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    mt: eyebrow ? 0.5 : 0,
                    lineHeight: 1.3,
                }}
            >
                {title}
            </Typography>
            {sub && (
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mt: 0.5, lineHeight: 1.5, maxWidth: 640 }}>
                    {sub}
                </Typography>
            )}
        </Box>
    );
}

// Hero band — a tinted accent surface (the sidenav's active-row family), so
// it reads as part of the app in both modes instead of a contrasting slab.
export function Hero({
    breadcrumb,
    title,
    sub,
    titleComponent = 'h1',
    children,
}: {
    breadcrumb: ReactNode;
    title: ReactNode;
    sub?: ReactNode;
    /** `/analytics` already has the page h1 in PageHeader. */
    titleComponent?: 'h1' | 'h2' | 'p';
    children?: ReactNode;
}) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.accentSoft,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '16px',
                color: ATLAS_PALETTE.slate,
                p: { xs: 2.5, md: 4 },
                mb: { xs: 3, md: 4 },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>{breadcrumb}</Box>
            <Typography
                component={titleComponent}
                sx={{
                    fontSize: { xs: 19, md: 24 },
                    fontWeight: 650,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.3,
                    color: ATLAS_PALETTE.slate,
                    maxWidth: '62ch',
                }}
            >
                {title}
            </Typography>
            {sub && <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mt: 1 }}>{sub}</Typography>}
            {children && (
                <Box
                    sx={{
                        mt: 3,
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
                        gap: { xs: 2, md: 4 },
                    }}
                >
                    {children}
                </Box>
            )}
        </Box>
    );
}

/** A change vs the previous window. `goodWhen` says which direction is good news. */
export function Delta({
    cur,
    prev,
    goodWhen,
    points = false,
}: {
    cur: number | null;
    prev: number | null;
    goodWhen: 'up' | 'down';
    /** For a rate (0–1): the change in percentage points, not a % of a %. */
    points?: boolean;
}) {
    if (cur === null || prev === null) return <>no earlier data</>;
    if (!points && prev === 0) return <>{cur === 0 ? 'same as before' : 'none before'}</>;
    const pct = points ? cur - prev : (cur - prev) / prev;
    if (Math.abs(pct) < 0.005) return <>same as before</>;
    const up = pct > 0;
    const good = up === (goodWhen === 'up');
    return (
        <Box
            component="span"
            sx={{ color: good ? ATLAS_PALETTE.successFg : ATLAS_PALETTE.dangerFg, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
            <Box component="span" aria-hidden="true">
                {up ? '▲' : '▼'}{' '}
            </Box>
            {up ? 'up' : 'down'} {Math.abs(pct * 100).toFixed(0)}
            {points ? ' pts' : '%'}
        </Box>
    );
}

/**
 * A headline number with its definition one tap away (the info button is a
 * real button, so the tooltip reaches keyboard and touch too).
 */
export function StatTile({
    label,
    value,
    definition,
    caption,
}: {
    label: string;
    value: ReactNode;
    definition: string;
    caption?: ReactNode;
}) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: { xs: 2, md: 2.5 },
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, fontWeight: 500, lineHeight: 1.35 }}>
                    {label}
                </Typography>
                <Tooltip title={definition} enterTouchDelay={0} leaveTouchDelay={4000}>
                    <Box
                        component="button"
                        type="button"
                        aria-label={`How ${label} is measured`}
                        sx={{
                            all: 'unset',
                            cursor: 'help',
                            color: ATLAS_PALETTE.slate40,
                            display: 'inline-flex',
                            borderRadius: '50%',
                            flexShrink: 0,
                            '&:focus-visible': { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: 2 },
                        }}
                    >
                        <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 16 }}>
                            info
                        </Box>
                    </Box>
                </Tooltip>
            </Box>
            <Typography
                sx={{
                    fontFamily: MONO,
                    fontSize: { xs: 20, md: 24 },
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate,
                    lineHeight: 1.15,
                    fontVariantNumeric: 'tabular-nums',
                    overflowWrap: 'anywhere',
                }}
            >
                {value}
            </Typography>
            {caption && (
                <Typography component="div" sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, lineHeight: 1.4 }}>
                    {caption}
                </Typography>
            )}
        </Box>
    );
}

/** Tile grid: 2 columns on a phone, `cols` from md up. */
export function TileGrid({ cols, children }: { cols: number; children: ReactNode }) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${cols}, minmax(0, 1fr))` },
                gap: { xs: 1.5, md: 2 },
            }}
        >
            {children}
        </Box>
    );
}

export const TOOLTIP_STYLE = {
    contentStyle: {
        fontSize: 12,
        background: ATLAS_PALETTE.surfaceRaised,
        borderRadius: '10px',
        border: `1px solid ${ATLAS_PALETTE.slate10}`,
        boxShadow: 'var(--atlas-elevation-mid)',
        color: ATLAS_PALETTE.slate,
    },
    labelStyle: { fontWeight: 600, color: ATLAS_PALETTE.slate },
    itemStyle: { color: ATLAS_PALETTE.slate },
    cursor: { fill: 'rgba(127,127,127,.10)' },
} as const;

export const AXIS_TICK = { fontSize: 11, fill: ATLAS_PALETTE.slate60, fontFamily: MONO };

export const WINDOW_LABEL: Record<AnalyticsWindow, string> = {
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    month: 'This month',
};

/** "the 7 days before" / "the same days last month": what a delta compares against. */
export function previousLabel(window: AnalyticsWindow): string {
    return window === 'month' ? 'vs the same days last month' : `vs the ${WINDOW_LABEL[window]} before`;
}

export function TabSkeleton() {
    return (
        <Box sx={{ display: 'grid', gap: 2 }} aria-busy="true" aria-label="Loading">
            <Skeleton variant="rounded" height={120} />
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' } }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} variant="rounded" height={104} />
                ))}
            </Box>
            <Skeleton variant="rounded" height={280} />
        </Box>
    );
}

/** Horizontal scroll for a wide table on a phone; the page itself never scrolls sideways. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Box
            role="region"
            aria-label={label}
            tabIndex={0}
            sx={{
                overflowX: 'auto',
                mx: { xs: -2.5, md: 0 },
                px: { xs: 2.5, md: 0 },
                '&:focus-visible': { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: 2 },
            }}
        >
            {children}
        </Box>
    );
}

/** `2026-10-12` → "Oct 12", read as a local calendar date (no UTC drift). */
export function bucketLabel(ymd: string): string {
    const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return ymd;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The Monday a `YYYY-MM-DD` falls in, as `YYYY-MM-DD` — Postgres `date_trunc('week')`. */
export function mondayOf(ymd: string): string {
    const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
}

export function formatRate(v: number | null): string {
    return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export interface BarRow {
    key: string;
    label: ReactNode;
    value: number;
    /** The number as printed — always visible, so colour never carries the value alone. */
    display: string;
    color?: string;
    note?: ReactNode;
}

/** One measure across named rows: a single colour, sorted by the caller, value printed on every row. */
export function BarList({ rows, color = CHART_PALETTE.cost, label }: { rows: BarRow[]; color?: string; label: string }) {
    const max = Math.max(0, ...rows.map((r) => r.value));
    return (
        <Box component="ul" aria-label={label} sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
            {rows.map((r) => (
                <Box component="li" key={r.key} sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.5, alignItems: 'baseline' }}>
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, minWidth: 0, overflowWrap: 'anywhere' }}>
                            {r.label}
                            {r.note && (
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate60, ml: 1, fontSize: 12 }}>
                                    {r.note}
                                </Box>
                            )}
                        </Typography>
                        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12.5, color: ATLAS_PALETTE.slate80, flexShrink: 0 }}>
                            {r.display}
                        </Typography>
                    </Box>
                    <Box sx={{ height: 8, borderRadius: '4px', background: ATLAS_PALETTE.slate06, overflow: 'hidden' }}>
                        <Box
                            sx={{
                                height: '100%',
                                width: max > 0 ? `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%` : 0,
                                background: r.color ?? color,
                                borderRadius: '4px',
                            }}
                        />
                    </Box>
                </Box>
            ))}
        </Box>
    );
}

/** Two-column card grid that collapses to one column below md. */
export function CardGrid({ children }: { children: ReactNode }) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
                gap: { xs: 2, md: 3 },
            }}
        >
            {children}
        </Box>
    );
}

/** Recharts legend labels in ink, not the series colour; the swatch carries identity. */
export const LEGEND_PROPS = {
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: { fontSize: 12 },
    formatter: (value: string) => (
        <Box component="span" sx={{ color: ATLAS_PALETTE.slate80 }}>
            {value}
        </Box>
    ),
};

// Axis and tooltip formatters, named so every chart shares (and tests) one copy.
export const usdTick = (v: number) => `$${v}`;
export const hourTick = (v: number) => `${v}h`;
export const tokenTick = (v: number) => formatTokenCount(v);
export const usdTooltip = (v: unknown) => formatCostUsd(Number(v));
export const tokenTooltip = (v: unknown) => formatTokenCount(Number(v));
export const hoursTooltip = (v: unknown) => formatSpan(Number(v) * 3600);
/** A link inside a clickable row: follow the link, not the row. */
export const stopRowClick = (e: { stopPropagation: () => void }) => e.stopPropagation();
