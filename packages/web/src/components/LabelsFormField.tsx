import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { ATLAS_PALETTE, LABEL_COLORS, type LabelColorKey, type LabelColorPair } from '../theme/tokens.js';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';

interface Props {
    labels: string[];
    onChange: (next: string[]) => void;
    suggestions: string[];
    /** Optional helper text under the field. */
    helperText?: string;
}

// Same palette + hashing as LabelsRailRow — palette source-of-truth is
// LABEL_COLORS in tokens.ts so the same label hashes to the same colour
// everywhere it appears.
const LABEL_KEYS = Object.keys(LABEL_COLORS) as LabelColorKey[];

function labelColorIndex(label: string): number {
    let h = 5381;
    for (let i = 0; i < label.length; i++) {
        h = (h << 5) + h + label.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % LABEL_KEYS.length;
}

const CHIP_FONT = '"JetBrains Mono", monospace';

export function LabelsFormField({ labels, onChange, suggestions, helperText }: Props) {
    const { mode } = useThemeModeContext();
    const labelColor = (l: string): LabelColorPair =>
        LABEL_COLORS[LABEL_KEYS[labelColorIndex(l)]!]![mode];

    function commit(next: readonly string[]) {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of next) {
            const v = raw.trim().slice(0, 40);
            if (!v || seen.has(v)) continue;
            seen.add(v);
            cleaned.push(v);
            if (cleaned.length >= 20) break;
        }
        onChange(cleaned);
    }

    return (
        <Box>
            <Typography
                sx={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate60,
                    mb: 1.5,
                }}
            >
                Labels{' '}
                <Box component="span" sx={{ color: ATLAS_PALETTE.slate40, fontWeight: 400 }}>
                    â€” optional, press Enter to add
                </Box>
            </Typography>
            <Autocomplete
                multiple
                freeSolo
                size="small"
                value={labels}
                options={suggestions.filter((s) => !labels.includes(s))}
                onChange={(_e, next) => commit(next as string[])}
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
                                    height: 24,
                                    px: 1,
                                    m: 0.25,
                                    background: c.bg,
                                    color: c.fg,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: '4px',
                                    fontFamily: CHIP_FONT,
                                    fontSize: 11.5,
                                    lineHeight: 1,
                                    cursor: 'default',
                                }}
                            >
                                <span>{option}</span>
                                <Box
                                    component="span"
                                    onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
                                    onClick={(e: React.MouseEvent<HTMLSpanElement>) => onDelete(e)}
                                    sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: 14,
                                        height: 14,
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        opacity: 0.6,
                                        transition: 'opacity 120ms ease, background 120ms ease',
                                        '&:hover': {
                                            opacity: 1,
                                            background: `${c.border}80`,
                                        },
                                    }}
                                >
                                    <CloseRoundedIcon sx={{ fontSize: 11 }} />
                                </Box>
                            </Box>
                        );
                    })
                }
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder={labels.length === 0 ? 'Type a label and press Enterâ€¦' : ''}
                        helperText={helperText}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                fontSize: 13,
                                background: ATLAS_PALETTE.white,
                                fontFamily: CHIP_FONT,
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
                                fontSize: 12.5,
                                fontFamily: CHIP_FONT,
                                py: 0.75,
                            },
                        },
                    },
                }}
            />
        </Box>
    );
}
