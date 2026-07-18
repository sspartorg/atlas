import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

export type LayoutKind =
    | 'single'
    | 'h2'
    | 'v2'
    | 'h3-top'
    | 'h3-bottom'
    | 'v3'
    | 'h3'
    | 'grid2x2';

export const LAYOUT_LABELS: Record<LayoutKind, string> = {
    single: 'Single',
    h2: 'Two — stacked',
    v2: 'Two — side by side',
    'h3-top': 'Three — 1 top · 2 bottom',
    'h3-bottom': 'Three — 2 top · 1 bottom',
    v3: 'Three columns',
    h3: 'Three rows',
    grid2x2: 'Four — 2 × 2',
};

export const LAYOUT_PANE_COUNT: Record<LayoutKind, number> = {
    single: 1,
    h2: 2,
    v2: 2,
    'h3-top': 3,
    'h3-bottom': 3,
    v3: 3,
    h3: 3,
    grid2x2: 4,
};

// Grouped by pane count so the menu can render a small header per group
// (1 / 2 / 3 / 4) with just the icons underneath — no long text captions,
// tooltip on hover gives the full label. The order within each group
// preserves the pre-grouping LAYOUT_ORDER so keyboard nav stays stable.
const LAYOUTS_BY_PANES: Array<{ paneCount: 1 | 2 | 3 | 4; kinds: LayoutKind[] }> = [
    { paneCount: 1, kinds: ['single'] },
    { paneCount: 2, kinds: ['h2', 'v2'] },
    { paneCount: 3, kinds: ['h3-top', 'h3-bottom', 'v3', 'h3'] },
    { paneCount: 4, kinds: ['grid2x2'] },
];

// Flat kind order matching the on-screen reading direction: within each
// group, left-to-right; across groups, top-to-bottom. Keyboard nav uses
// this list to move focus with ArrowDown/ArrowRight (forward) and
// ArrowUp/ArrowLeft (back), so the traversal always follows the visual
// order regardless of how the groups are nested in the DOM.
const FLAT_LAYOUT_ORDER: LayoutKind[] = LAYOUTS_BY_PANES.flatMap((g) => g.kinds);

interface ShapeProps {
    size?: number;
    selected?: boolean;
}

function ShapeIcon({ kind, size = 32, selected }: ShapeProps & { kind: LayoutKind }) {
    const fg = selected ? ATLAS_PALETTE.onAccent : ATLAS_PALETTE.slate;
    const bg = selected ? ATLAS_PALETTE.slate : ATLAS_PALETTE.surfaceRaised;
    const stroke = selected ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate30;
    const cell = (
        x: number,
        y: number,
        w: number,
        h: number,
    ): ReactElement => (
        <rect
            key={`${x}-${y}-${w}-${h}`}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={2}
            ry={2}
            fill={fg}
            opacity={0.85}
        />
    );

    const VW = 40;
    const VH = 28;
    const G = 2; // gap

    const cells: ReactElement[] = [];
    switch (kind) {
        case 'single':
            cells.push(cell(2, 2, VW - 4, VH - 4));
            break;
        case 'h2': {
            const half = (VH - 4 - G) / 2;
            cells.push(cell(2, 2, VW - 4, half));
            cells.push(cell(2, 2 + half + G, VW - 4, half));
            break;
        }
        case 'v2': {
            const half = (VW - 4 - G) / 2;
            cells.push(cell(2, 2, half, VH - 4));
            cells.push(cell(2 + half + G, 2, half, VH - 4));
            break;
        }
        case 'h3-top': {
            const halfH = (VH - 4 - G) / 2;
            const halfW = (VW - 4 - G) / 2;
            cells.push(cell(2, 2, VW - 4, halfH));
            cells.push(cell(2, 2 + halfH + G, halfW, halfH));
            cells.push(cell(2 + halfW + G, 2 + halfH + G, halfW, halfH));
            break;
        }
        case 'h3-bottom': {
            const halfH = (VH - 4 - G) / 2;
            const halfW = (VW - 4 - G) / 2;
            cells.push(cell(2, 2, halfW, halfH));
            cells.push(cell(2 + halfW + G, 2, halfW, halfH));
            cells.push(cell(2, 2 + halfH + G, VW - 4, halfH));
            break;
        }
        case 'v3': {
            const third = (VW - 4 - 2 * G) / 3;
            cells.push(cell(2, 2, third, VH - 4));
            cells.push(cell(2 + third + G, 2, third, VH - 4));
            cells.push(cell(2 + 2 * (third + G), 2, third, VH - 4));
            break;
        }
        case 'h3': {
            const third = (VH - 4 - 2 * G) / 3;
            cells.push(cell(2, 2, VW - 4, third));
            cells.push(cell(2, 2 + third + G, VW - 4, third));
            cells.push(cell(2, 2 + 2 * (third + G), VW - 4, third));
            break;
        }
        case 'grid2x2': {
            const halfH = (VH - 4 - G) / 2;
            const halfW = (VW - 4 - G) / 2;
            cells.push(cell(2, 2, halfW, halfH));
            cells.push(cell(2 + halfW + G, 2, halfW, halfH));
            cells.push(cell(2, 2 + halfH + G, halfW, halfH));
            cells.push(cell(2 + halfW + G, 2 + halfH + G, halfW, halfH));
            break;
        }
    }

    return (
        <svg
            width={size}
            height={size * (VH / VW)}
            viewBox={`0 0 ${VW} ${VH}`}
            aria-hidden
            style={{ display: 'block' }}
        >
            <rect
                x={0.5}
                y={0.5}
                width={VW - 1}
                height={VH - 1}
                rx={3}
                ry={3}
                fill={bg}
                stroke={stroke}
            />
            {cells}
        </svg>
    );
}

interface LayoutPickerMenuProps {
    value: LayoutKind;
    onChange: (next: LayoutKind) => void;
}

// 2026-07-03 audit round 2 rewrite. The previous implementation wrapped
// MenuItems in Box containers inside a MUI <Menu>, which renders a
// <ul role="menu"> whose direct children are <li role="menuitem">. MUI's
// MenuList uses DOM nextElementSibling for arrow-key navigation and
// React.Children.forEach for selected-item autoFocus — both operate on
// the immediate children of <ul>. The Box wrappers made the <ul> have
// exactly one direct child (a <div>), so keyboard nav dead-ended on the
// first press and autoFocus landed on the wrapper instead of the current
// selection. Screen readers also saw invalid markup (<div> under
// <ul role="menu">).
//
// This rewrite keeps the horizontal pane-group visual but drops <Menu>:
//   - Uses <Popover> as the surface (no forced <ul> child structure).
//   - Renders an explicit role="menu" container with role="group" (and
//     aria-label) per pane-count row and role="menuitem" per icon.
//   - Wires arrow-key / Home / End / Enter / Space / Escape handlers on
//     the container so keyboard users can traverse the icons in the same
//     left-to-right, top-to-bottom order they see them.
//   - On open, focus lands on the currently-selected item (matches the
//     variant='selectedMenu' UX the previous version broke).
export function LayoutPickerMenu({ value, onChange }: LayoutPickerMenuProps) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = Boolean(anchor);
    // The focused index is what receives tabIndex=0; every other item
    // gets tabIndex=-1 (roving-tabindex pattern). On open we seed it to
    // the currently-selected item so keyboard users don't lose their
    // place when reopening the picker.
    const [focusIndex, setFocusIndex] = useState<number>(() =>
        Math.max(0, FLAT_LAYOUT_ORDER.indexOf(value)),
    );
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // Whenever the picker opens, re-seed the focused index to the current
    // selection so keyboard users don't lose their place when reopening.
    useEffect(() => {
        if (!open) return;
        const initial = Math.max(0, FLAT_LAYOUT_ORDER.indexOf(value));
        setFocusIndex(initial);
    }, [open, value]);

    // Move DOM focus to the currently-focused index whenever the picker
    // is open AND focusIndex changes (arrow-key nav). The initial focus
    // on open is handled via `TransitionProps.onEntered` on the Popover
    // below — running it here in a useEffect races MUI's Modal focus
    // trap which asynchronously moves focus onto the Paper on mount,
    // even with disableAutoFocus. The Grow-transition onEntered fires
    // AFTER the trap has settled, so our focus() call sticks.
    useLayoutEffect(() => {
        if (!open) return;
        const btn = itemRefs.current[focusIndex];
        if (btn) btn.focus();
    }, [focusIndex, open]);

    const focusSelectedOnOpen = useCallback(() => {
        const initial = Math.max(0, FLAT_LAYOUT_ORDER.indexOf(value));
        const btn = itemRefs.current[initial];
        if (btn) btn.focus();
    }, [value]);

    const commit = useCallback(
        (kind: LayoutKind) => {
            onChange(kind);
            setAnchor(null);
        },
        [onChange],
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const last = FLAT_LAYOUT_ORDER.length - 1;
            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown': {
                    e.preventDefault();
                    setFocusIndex((i) => (i >= last ? 0 : i + 1));
                    break;
                }
                case 'ArrowLeft':
                case 'ArrowUp': {
                    e.preventDefault();
                    setFocusIndex((i) => (i <= 0 ? last : i - 1));
                    break;
                }
                case 'Home': {
                    e.preventDefault();
                    setFocusIndex(0);
                    break;
                }
                case 'End': {
                    e.preventDefault();
                    setFocusIndex(last);
                    break;
                }
                case 'Enter':
                case ' ': {
                    e.preventDefault();
                    const kind = FLAT_LAYOUT_ORDER[focusIndex];
                    if (kind) commit(kind);
                    break;
                }
                case 'Escape': {
                    e.preventDefault();
                    setAnchor(null);
                    break;
                }
                default:
                    break;
            }
        },
        [focusIndex, commit],
    );

    const groupedRows = useMemo(() => {
        // Precompute the flat index of the first icon in each group so
        // we can wire the roving tabindex without a per-render lookup.
        let running = 0;
        return LAYOUTS_BY_PANES.map(({ paneCount, kinds }) => {
            const start = running;
            running += kinds.length;
            return { paneCount, kinds, startIndex: start };
        });
    }, []);

    return (
        <>
            <Tooltip title="Choose layout">
                <IconButton
                    size="small"
                    onClick={(e) => setAnchor(e.currentTarget)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    sx={{
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '6px',
                        p: 0.5,
                    }}
                >
                    <ShapeIcon kind={value} size={28} />
                </IconButton>
            </Tooltip>
            <Popover
                open={open}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                // `disableAutoFocus` prevents MUI's Modal from firing its
                // own initial-focus flow (which lands on the Paper
                // container and races with our own placement). We call
                // focus() ourselves in the TransitionProps.onEntered
                // hook below AFTER the Grow-in animation completes —
                // guaranteed to land on the selected menuitem.
                disableAutoFocus
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            p: 1,
                            mt: 0.5,
                        },
                    },
                }}
                TransitionProps={{ onEntered: focusSelectedOnOpen }}
            >
                <Box
                    role="menu"
                    aria-label="Pane layout"
                    onKeyDown={onKeyDown}
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, outline: 'none' }}
                >
                    {groupedRows.map(({ paneCount, kinds, startIndex }) => (
                        <Box
                            key={paneCount}
                            role="group"
                            aria-label={`${paneCount} pane${paneCount === 1 ? '' : 's'}`}
                        >
                            <Typography
                                aria-hidden
                                variant="caption"
                                sx={{
                                    display: 'block',
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: ATLAS_PALETTE.slate60,
                                    letterSpacing: 0.8,
                                    px: 0.5,
                                    mb: 0.25,
                                    textTransform: 'uppercase',
                                }}
                            >
                                {paneCount}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                {kinds.map((kind, offset) => {
                                    const idx = startIndex + offset;
                                    const selected = kind === value;
                                    return (
                                        <Tooltip key={kind} title={LAYOUT_LABELS[kind]}>
                                            <ButtonBase
                                                ref={(el: HTMLButtonElement | null) => {
                                                    itemRefs.current[idx] = el;
                                                }}
                                                role="menuitem"
                                                aria-label={LAYOUT_LABELS[kind]}
                                                aria-current={selected ? 'true' : undefined}
                                                tabIndex={idx === focusIndex ? 0 : -1}
                                                onClick={() => commit(kind)}
                                                sx={{
                                                    p: 0.75,
                                                    borderRadius: 1,
                                                    // Selected-item ring — matches MUI's
                                                    // MenuItem 'selected' visual so users
                                                    // returning to the picker see their
                                                    // current choice at a glance.
                                                    bgcolor: selected
                                                        ? 'rgba(0,0,0,0.04)'
                                                        : 'transparent',
                                                    '&:hover': {
                                                        bgcolor: 'rgba(0,0,0,0.06)',
                                                    },
                                                    '&:focus-visible': {
                                                        outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                                                        outlineOffset: 1,
                                                    },
                                                }}
                                            >
                                                <Box sx={{ pointerEvents: 'none' }}>
                                                    <ShapeIcon
                                                        kind={kind}
                                                        selected={selected}
                                                        size={40}
                                                    />
                                                </Box>
                                            </ButtonBase>
                                        </Tooltip>
                                    );
                                })}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Popover>
        </>
    );
}
