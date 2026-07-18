import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// ── Pill-style primary filter ─────────────────────────────────────────────

interface FilterPillProps {
    label: string;
    count?: number | undefined;
    selected: boolean;
    onClick: () => void;
    icon?: ReactNode | undefined;
    accentColor?: { bg: string; fg: string } | undefined;
}

export function FilterPill({
    label,
    count,
    selected,
    onClick,
    icon,
    accentColor,
}: FilterPillProps) {
    const selectedBg = accentColor?.bg ?? ATLAS_PALETTE.slate;
    // onAccent is white in light mode and dark-slate in dark mode so the
    // selected pill text stays legible against the (theme-flipping) accent bg.
    const selectedFg = accentColor?.fg ?? ATLAS_PALETTE.onAccent;
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: icon ? 0.75 : 1.5,
                padding: '4px 12px',
                borderRadius: '9999px',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'all 150ms ease',
                fontSize: 13,
                fontWeight: 500,
                bgcolor: selected ? selectedBg : ATLAS_PALETTE.white,
                color: selected ? selectedFg : ATLAS_PALETTE.slate,
                border: selected ? '1px solid transparent' : `1px solid ${ATLAS_PALETTE.slate10}`,
                '&:hover': {
                    bgcolor: selected ? selectedBg : ATLAS_PALETTE.cloud,
                },
            }}
        >
            {icon}
            <Box component="span">{label}</Box>
            {count !== undefined && (
                <Box
                    component="span"
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 20,
                        padding: '0 6px',
                        borderRadius: '9999px',
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        fontWeight: 600,
                        bgcolor: selected
                            ? `color-mix(in srgb, ${ATLAS_PALETTE.onAccent} 18%, transparent)`
                            : ATLAS_PALETTE.slate08,
                        color: selected ? selectedFg : ATLAS_PALETTE.slate60,
                    }}
                >
                    {count}
                </Box>
            )}
        </Box>
    );
}

// ── Dropdown chip ─────────────────────────────────────────────────────────

export interface DropdownOption<T extends string | null = string | null> {
    value: T;
    label: string;
}

interface DropdownChipProps<T extends string | null> {
    label: string;
    value: T;
    options: DropdownOption<T>[];
    onChange: (v: T) => void;
}

export function DropdownChip<T extends string | null>({
    label,
    value,
    options,
    onChange,
}: DropdownChipProps<T>) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const current = options.find((o) => o.value === value) ?? options[0];
    return (
        <>
            <Box
                role="button"
                tabIndex={0}
                onClick={(e) => setAnchor(e.currentTarget)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') setAnchor(e.currentTarget as HTMLElement);
                }}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    padding: '4px 10px 4px 12px',
                    borderRadius: '9999px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 150ms ease',
                    fontSize: 13,
                    fontWeight: 500,
                    bgcolor: ATLAS_PALETTE.white,
                    color: ATLAS_PALETTE.slate,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                }}
            >
                <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    {label}:
                </Typography>
                <Typography
                    component="span"
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 500 }}
                >
                    {current?.label ?? 'any'}
                </Typography>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}
                >
                    arrow_drop_down
                </Box>
            </Box>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            minWidth: 180,
                        },
                    },
                }}
            >
                {options.map((o) => (
                    <MenuItem
                        key={String(o.value)}
                        onClick={() => {
                            onChange(o.value);
                            setAnchor(null);
                        }}
                        sx={{ fontSize: 13, py: 1.25 }}
                    >
                        {o.label}
                        {o.value === value && (
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue, ml: 'auto' }}
                            >
                                check
                            </Box>
                        )}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}

// ── Search box with `/` keyboard shortcut ────────────────────────────────
//
// Uses the unified outlined+label TextField shell from the theme (40px tall,
// no pill rounding). The `/` keyboard shortcut still focuses the field, and
// a `/` hint chip sits in the end adornment as a discoverability cue.

interface SearchPillTextFieldProps {
    /** Floating label shown in the notched outline. */
    label?: string;
    value: string;
    onChange: (next: string) => void;
    minWidth?: number | undefined;
}

export function SearchPillTextField({
    label,
    value,
    onChange,
    minWidth = 240,
}: SearchPillTextFieldProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        function onKey(e: globalThis.KeyboardEvent) {
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                inputRef.current?.focus();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <TextField
            label={label ?? 'Search'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputRef={inputRef}
            sx={{
                width: { xs: '100%', md: 'auto' },
                minWidth: { xs: 0, md: minWidth },
            }}
            slotProps={{
                input: {
                    startAdornment: (
                        <InputAdornment position="start">
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40 }}
                            >
                                search
                            </Box>
                        </InputAdornment>
                    ),
                    endAdornment: (
                        <InputAdornment position="end">
                            <Box
                                component="span"
                                sx={{
                                    fontFamily: '"JetBrains Mono", monospace',
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate40,
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    borderRadius: '4px',
                                    px: 0.75,
                                    py: 0.25,
                                    lineHeight: 1.2,
                                    display: { xs: 'none', md: 'inline-flex' },
                                }}
                            >
                                /
                            </Box>
                        </InputAdornment>
                    ),
                },
            }}
        />
    );
}

// ── Sortable table header cell ────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

interface SortableHeaderProps<K extends string> {
    label: string;
    sortKey: K | null;
    current: K | null;
    dir: SortDir;
    onChange: (k: K) => void;
    align?: 'left' | 'right' | undefined;
}

export function SortableHeader<K extends string>({
    label,
    sortKey,
    current,
    dir,
    onChange,
    align,
}: SortableHeaderProps<K>) {
    const active = current === sortKey;
    return (
        <Box
            onClick={() => sortKey && onChange(sortKey)}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: sortKey ? 'pointer' : 'default',
                userSelect: 'none',
                justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
            }}
        >
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {label}
            </Typography>
            {sortKey && (
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{
                        fontSize: 14,
                        color: active ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.slate30,
                    }}
                >
                    {active && dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}
                </Box>
            )}
        </Box>
    );
}
