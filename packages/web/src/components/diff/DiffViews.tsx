import { useRef, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { DiffLineText } from './DiffLineText.js';
import { rowKey, type SplitViewRow, type UnifiedViewRow } from './diffRows.js';

// 2026-08-04 — Terminal finalize diff, the two row renderers.
//
// KEY DECISION 1 — split view is ONE scroll container, not two.
//
// Each row is a single DOM node holding both halves as sibling flex cells.
// There is no scroll listener, no rAF loop, and no drift to test for, because
// desync is structurally impossible. It also means ONE virtualizer instead of
// two that would have to agree on row heights.
//
// The cost: a single container can't give each half its own horizontal
// scrollbar. That's why `wrap` defaults ON in split (columns are ~45% of the
// viewport, where wrapping is what a reviewer wants anyway) and OFF in
// unified (full dialog width, one container-level scrollbar).
//
// KEY DECISION 2 — virtualize only ABOVE a threshold.
//
// react-virtual needs a measured scroll container. Below ~500 rows there is
// nothing to gain (the DOM handles it fine) and plenty to lose: a virtualizer
// that mounts before its ResizeObserver fires renders a blank frame, and under
// jsdom — where ResizeObserver is a noop stub — it renders nothing at all,
// making the component untestable. Plain rendering under the threshold covers
// the overwhelming majority of real diffs and removes that whole failure mode.

const LINE_H = 20;
const GUTTER_W = 52;

/** Above this many rows, switch to windowed rendering. */
const VIRTUALIZE_ABOVE_ROWS = 500;

/** Hard stop — past this we refuse to render and say so. */
export const MAX_ROWS_PER_FILE = 20_000;

const monoSx = {
    fontFamily: TYPOGRAPHY.fontFamilyMono,
    fontSize: 12,
    lineHeight: `${LINE_H}px`,
} as const;

const gutterSx = {
    width: GUTTER_W,
    flexShrink: 0,
    textAlign: 'right' as const,
    pr: 1,
    userSelect: 'none' as const,
    bgcolor: ATLAS_PALETTE.diffGutterBg,
    color: ATLAS_PALETTE.diffGutterFg,
};

function contentSx(wrap: boolean) {
    return {
        flex: 1,
        minWidth: 0,
        px: 1,
        whiteSpace: wrap ? ('pre-wrap' as const) : ('pre' as const),
        wordBreak: wrap ? ('break-word' as const) : ('normal' as const),
        overflowWrap: wrap ? ('anywhere' as const) : ('normal' as const),
    };
}

interface HunkRowProps {
    label: string;
    skipped: number;
    onExpand: (() => void) | undefined;
    canExpand: boolean;
}

function HunkSeparator({ label, skipped, onExpand, canExpand }: HunkRowProps) {
    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            onClick={canExpand ? onExpand : undefined}
            sx={{
                ...monoSx,
                minHeight: LINE_H,
                px: 1,
                bgcolor: ATLAS_PALETTE.diffHunkBg,
                color: ATLAS_PALETTE.diffHunkFg,
                cursor: canExpand ? 'pointer' : 'default',
            }}
        >
            {/* Text glyph rather than a MUI icon — @mui/icons-material lands in
                the shared mui-icons chunk, which the bundle gate counts as
                INITIAL, and that budget has ~0.1 KB of slack. */}
            <Typography component="span" sx={{ ...monoSx, color: 'inherit' }}>
                {skipped > 0
                    ? `${canExpand ? '⌄ ' : '⋯ '}${skipped} unchanged line${skipped === 1 ? '' : 's'}`
                    : label}
            </Typography>
        </Stack>
    );
}

/**
 * Renders rows plainly below the threshold and windowed above it. Both paths
 * emit the same markup per row, so nothing downstream cares which ran.
 */
function RowList({
    count,
    wrap,
    viewKey,
    renderRow,
    keyFor,
}: {
    count: number;
    wrap: boolean;
    viewKey: string;
    renderRow: (index: number) => ReactNode;
    keyFor: (index: number) => string;
}) {
    const parentRef = useRef<HTMLDivElement | null>(null);
    const virtualize = count > VIRTUALIZE_ABOVE_ROWS;

    const virtualizer = useVirtualizer({
        count: virtualize ? count : 0,
        getScrollElement: () => parentRef.current,
        estimateSize: () => LINE_H,
        overscan: 12,
        getItemKey: keyFor,
    });

    // Wrapping and mode changes both change every row's height, so the cached
    // measurements would otherwise describe the previous layout.
    useEffect(() => {
        if (virtualize) virtualizer.measure();
    }, [wrap, viewKey, virtualize, virtualizer]);

    if (!virtualize) {
        return (
            <Box ref={parentRef} sx={{ overflow: 'auto', height: '100%', ...monoSx }}>
                <Box sx={{ minWidth: 'fit-content' }}>
                    {Array.from({ length: count }, (_, i) => (
                        <Box key={keyFor(i)}>{renderRow(i)}</Box>
                    ))}
                </Box>
            </Box>
        );
    }

    return (
        <Box ref={parentRef} sx={{ overflow: 'auto', height: '100%', ...monoSx }}>
            <Box
                sx={{
                    height: virtualizer.getTotalSize(),
                    position: 'relative',
                    minWidth: 'fit-content',
                }}
            >
                {virtualizer.getVirtualItems().map((vi) => (
                    <Box
                        key={vi.key}
                        data-index={vi.index}
                        ref={virtualizer.measureElement}
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                        }}
                    >
                        {renderRow(vi.index)}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

interface ViewProps<R> {
    rows: R[];
    path: string;
    wrap: boolean;
    onExpandContext: (() => void) | undefined;
    canExpand: boolean;
}

export function UnifiedDiffView({
    rows,
    path,
    wrap,
    onExpandContext,
    canExpand,
}: ViewProps<UnifiedViewRow>) {
    return (
        <RowList
            count={rows.length}
            wrap={wrap}
            viewKey="unified"
            keyFor={(i) => rowKey(rows[i]!, i)}
            renderRow={(i) => {
                const row = rows[i]!;
                if (row.kind === 'hunk') {
                    return (
                        <HunkSeparator
                            label={row.label}
                            skipped={row.skipped}
                            onExpand={onExpandContext}
                            canExpand={canExpand}
                        />
                    );
                }
                return (
                    <Box
                        sx={{
                            display: 'flex',
                            minHeight: LINE_H,
                            bgcolor:
                                row.kind === 'add'
                                    ? ATLAS_PALETTE.diffAddBg
                                    : row.kind === 'del'
                                      ? ATLAS_PALETTE.diffDelBg
                                      : 'transparent',
                        }}
                    >
                        <Box sx={gutterSx}>{row.oldLine ?? ''}</Box>
                        <Box sx={gutterSx}>{row.newLine ?? ''}</Box>
                        <Box
                            sx={{
                                width: 16,
                                flexShrink: 0,
                                textAlign: 'center',
                                userSelect: 'none',
                                color: ATLAS_PALETTE.diffGutterFg,
                            }}
                        >
                            {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                        </Box>
                        <Box sx={contentSx(wrap)}>
                            <DiffLineText
                                text={row.content}
                                path={path}
                                side={row.kind}
                                counterpart={row.counterpart}
                            />
                        </Box>
                    </Box>
                );
            }}
        />
    );
}

export function SplitDiffView({
    rows,
    path,
    wrap,
    onExpandContext,
    canExpand,
}: ViewProps<SplitViewRow>) {
    return (
        <RowList
            count={rows.length}
            wrap={wrap}
            viewKey="split"
            keyFor={(i) => rowKey(rows[i]!, i)}
            renderRow={(i) => {
                const row = rows[i]!;
                if (row.kind === 'hunk') {
                    return (
                        <HunkSeparator
                            label={row.label}
                            skipped={row.skipped}
                            onExpand={onExpandContext}
                            canExpand={canExpand}
                        />
                    );
                }
                return (
                    <Box sx={{ display: 'flex', minHeight: LINE_H }}>
                        {/* LEFT */}
                        <Box
                            sx={{
                                display: 'flex',
                                // `1 1 0` + minWidth 0 gives an exact 50/50
                                // split regardless of content width; without
                                // minWidth a long unbroken token blows out the
                                // flex basis and the columns stop lining up.
                                flex: '1 1 0',
                                minWidth: 0,
                                borderRight: `1px solid ${ATLAS_PALETTE.slate08}`,
                                bgcolor: !row.left
                                    ? ATLAS_PALETTE.diffFillerBg
                                    : row.left.kind === 'del'
                                      ? ATLAS_PALETTE.diffDelBg
                                      : 'transparent',
                            }}
                        >
                            <Box sx={gutterSx}>{row.left?.line ?? ''}</Box>
                            <Box sx={contentSx(wrap)}>
                                {row.left ? (
                                    <DiffLineText
                                        text={row.left.content}
                                        path={path}
                                        side={row.left.kind}
                                        counterpart={row.paired ? (row.right?.content ?? null) : null}
                                    />
                                ) : null}
                            </Box>
                        </Box>
                        {/* RIGHT */}
                        <Box
                            sx={{
                                display: 'flex',
                                flex: '1 1 0',
                                minWidth: 0,
                                bgcolor: !row.right
                                    ? ATLAS_PALETTE.diffFillerBg
                                    : row.right.kind === 'add'
                                      ? ATLAS_PALETTE.diffAddBg
                                      : 'transparent',
                            }}
                        >
                            <Box sx={gutterSx}>{row.right?.line ?? ''}</Box>
                            <Box sx={contentSx(wrap)}>
                                {row.right ? (
                                    <DiffLineText
                                        text={row.right.content}
                                        path={path}
                                        side={row.right.kind}
                                        counterpart={row.paired ? (row.left?.content ?? null) : null}
                                    />
                                ) : null}
                            </Box>
                        </Box>
                    </Box>
                );
            }}
        />
    );
}
