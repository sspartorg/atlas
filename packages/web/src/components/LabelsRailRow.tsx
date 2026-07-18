import { useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { ATLAS_PALETTE, LABEL_COLORS, type LabelColorKey, type LabelColorPair } from '../theme/tokens.js';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';

interface Props {
    labels: string[];
    onChange: (next: string[]) => Promise<unknown> | void;
    suggestions: string[];
}

// Ten hand-tuned hues that read on the surface, avoid colliding with the
// status (green) / error (red) tokens used elsewhere in the rail, and stay
// legible at 11px. Each entry carries matched {bg, fg, border} pairs for
// light + dark mode. Hashing label-string → index makes every label
// deterministic — "backend" is always the same color on every page.
// Palette source-of-truth lives in tokens.ts (LABEL_COLORS).
const LABEL_KEYS = Object.keys(LABEL_COLORS) as LabelColorKey[];

function labelColorIndex(label: string): number {
    // djb2; cheap + good distribution across short strings.
    let h = 5381;
    for (let i = 0; i < label.length; i++) {
        h = (h << 5) + h + label.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % LABEL_KEYS.length;
}

const CHIP_FONT = '"JetBrains Mono", monospace';

// Trim + de-dupe + cap to match the API's Zod schema cap (20).
function clean(next: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of next) {
        const v = raw.trim().slice(0, 40);
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
        if (out.length >= 20) break;
    }
    return out;
}

function arraysEq(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export function LabelsRailRow({ labels, onChange, suggestions }: Props) {
    const { mode } = useThemeModeContext();
    const labelColor = (l: string): LabelColorPair =>
        LABEL_COLORS[LABEL_KEYS[labelColorIndex(l)]!]![mode];
    const [editing, setEditing] = useState(false);
    // Local staging buffer used only while the row is open for editing.
    // The Autocomplete writes here on every chip change — instant, no
    // network round-trip — and we flush once on blur. Mirrors how Jira /
    // Linear handle label edits (commit at the end, not per-keystroke).
    const [staged, setStaged] = useState<string[] | null>(null);

    const displayValue = staged ?? labels;

    // Suggestions list is recomputed against the live value so an
    // already-added chip drops out of the dropdown immediately.
    const optionPool = useMemo(
        () => suggestions.filter((s) => !displayValue.includes(s)),
        [suggestions, displayValue],
    );

    async function flush() {
        setEditing(false);
        if (staged === null) return;
        const next = clean(staged);
        setStaged(null);
        if (arraysEq(next, labels)) return;
        // The parent mutation hook (useUpdateEpic / Story / Bug) /
        // SubTaskDetail.patchTask / SubBugDetail.patchBug already
        // invalidates `['labels']` on success — no need to do it
        // here as well.
        await onChange(next);
    }

    function beginEdit() {
        setStaged([...labels]);
        setEditing(true);
    }

    return (
        <Box
            sx={{
                py: 1.5,
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:first-of-type': { borderTop: 0, pt: 0 },
                // Always-column layout — the chip flow needs its own row
                // so it can wrap cleanly at narrow rail widths instead of
                // sharing a flex row with the "Labels" caption.
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}
        >
            <Typography
                sx={{
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                }}
            >
                Labels
            </Typography>

            {editing ? (
                <Autocomplete
                    multiple
                    freeSolo
                    size="small"
                    open
                    autoFocus
                    value={displayValue}
                    options={optionPool}
                    onChange={(_e, next) => {
                        // Staging only — never fires the parent mutation
                        // until `flush()` runs on blur. This is what makes
                        // chip add/remove feel instant.
                        setStaged(clean(next as string[]));
                    }}
                    onBlur={() => {
                        void flush();
                    }}
                    renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                            const c = labelColor(option);
                            const { key, onDelete, ...tagProps } = getTagProps({ index });
                            return (
                                <Box
                                    key={key}
                                    {...tagProps}
                                    sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        height: 22,
                                        px: 1,
                                        m: 0.25,
                                        background: c.bg,
                                        color: c.fg,
                                        border: `1px solid ${c.border}`,
                                        borderRadius: '4px',
                                        fontFamily: CHIP_FONT,
                                        fontSize: 11,
                                        lineHeight: 1,
                                        cursor: 'default',
                                    }}
                                >
                                    <span>{option}</span>
                                    <Box
                                        component="span"
                                        onMouseDown={(e: React.MouseEvent) => {
                                            // Prevent the input from losing
                                            // focus before delete fires.
                                            e.preventDefault();
                                        }}
                                        onClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                                            onDelete(e);
                                        }}
                                        sx={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 14,
                                            height: 14,
                                            borderRadius: '50%',
                                            cursor: 'pointer',
                                            opacity: 0.6,
                                            transition: 'opacity 120ms ease',
                                            '&:hover': {
                                                opacity: 1,
                                                background: `${c.border}80`,
                                            },
                                        }}
                                    >
                                        <CloseRoundedIcon sx={{ fontSize: 10 }} />
                                    </Box>
                                </Box>
                            );
                        })
                    }
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            autoFocus
                            placeholder={labels.length === 0 ? 'Type a label…' : ''}
                            variant="outlined"
                            slotProps={{
                                input: {
                                    ...params.InputProps,
                                    sx: {
                                        fontSize: 12,
                                        fontFamily: CHIP_FONT,
                                        py: '4px !important',
                                        '& fieldset': {
                                            borderColor: ATLAS_PALETTE.brandBlue,
                                        },
                                    },
                                },
                            }}
                        />
                    )}
                    slotProps={{
                        paper: {
                            sx: {
                                mt: 0.5,
                                boxShadow: '0 8px 24px rgba(15,23,42,.12)',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                '& .MuiAutocomplete-option': {
                                    fontSize: 12,
                                    fontFamily: CHIP_FONT,
                                    py: 0.75,
                                },
                            },
                        },
                    }}
                />
            ) : labels.length === 0 ? (
                <Box
                    onClick={beginEdit}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            beginEdit();
                        }
                    }}
                    sx={{
                        // Dashed-pill empty-state CTA. Brightens to brand
                        // blue on hover so the row feels alive instead of
                        // showing a flat grey "None".
                        alignSelf: 'flex-start',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1.25,
                        py: 0.5,
                        borderRadius: '999px',
                        border: `1px dashed ${ATLAS_PALETTE.slate12}`,
                        color: ATLAS_PALETTE.slate60,
                        fontFamily: CHIP_FONT,
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease',
                        '&:hover, &:focus-visible': {
                            outline: 'none',
                            borderColor: ATLAS_PALETTE.brandBlue,
                            color: ATLAS_PALETTE.brandBlue,
                            background: ATLAS_PALETTE.cloud,
                        },
                    }}
                >
                    <AddRoundedIcon sx={{ fontSize: 13 }} />
                    Add labels
                </Box>
            ) : (
                <Box
                    onClick={beginEdit}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            beginEdit();
                        }
                    }}
                    sx={{
                        // Whole chip flow is the click target. Negative
                        // margin lets the hover halo extend past the chips
                        // without shifting layout.
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        mx: -0.5,
                        px: 0.5,
                        py: 0.25,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background 120ms ease',
                        '&:hover, &:focus-visible': {
                            outline: 'none',
                            background: ATLAS_PALETTE.cloud,
                        },
                    }}
                >
                    {labels.map((l) => {
                        const c = labelColor(l);
                        return (
                            <Box
                                key={l}
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    height: 22,
                                    px: 1,
                                    borderRadius: '4px',
                                    background: c.bg,
                                    color: c.fg,
                                    border: `1px solid ${c.border}`,
                                    fontFamily: CHIP_FONT,
                                    fontSize: 11,
                                    lineHeight: 1,
                                    // Stays crisp even when the rail compresses.
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={l}
                            >
                                {l}
                            </Box>
                        );
                    })}
                    <Box
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: '4px',
                            border: `1px dashed ${ATLAS_PALETTE.slate12}`,
                            color: ATLAS_PALETTE.slate40,
                            transition: 'border-color 120ms ease, color 120ms ease',
                            '.MuiBox-root:hover > &': {
                                borderColor: ATLAS_PALETTE.brandBlue,
                                color: ATLAS_PALETTE.brandBlue,
                            },
                        }}
                    >
                        <AddRoundedIcon sx={{ fontSize: 12 }} />
                    </Box>
                </Box>
            )}
        </Box>
    );
}
