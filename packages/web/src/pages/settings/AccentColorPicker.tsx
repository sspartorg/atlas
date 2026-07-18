import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BRAND_SECONDARY_ACCENTS } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Sourced from @atlas/shared so the picker can't drift from brand guidelines.
// brandBlue and green are reserved for primary UI / success and intentionally
// absent from the picker.
const SWATCHES = BRAND_SECONDARY_ACCENTS;

interface Props {
    value: string;
    onChange: (hex: string) => void;
}

export function AccentColorPicker({ value, onChange }: Props) {
    const normalized = value.toUpperCase();
    const selected = SWATCHES.find((s) => s.hex.toUpperCase() === normalized) ?? null;

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
                {SWATCHES.map((s) => {
                    const isSelected = s.hex.toUpperCase() === normalized;
                    return (
                        <Box
                            key={s.hex}
                            role="button"
                            aria-label={`Accent ${s.name}`}
                            aria-pressed={isSelected}
                            onClick={() => onChange(s.hex)}
                            sx={{
                                // Wrapper carries the ring as a real border on
                                // a wrapping element. Box-shadow rings (esp.
                                // with `inset`) don't repaint reliably on
                                // iOS Safari when toggled — border swaps do.
                                width: 36,
                                height: 36,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                padding: 0,
                                border: '2px solid transparent',
                                borderColor: isSelected ? s.hex : 'transparent',
                                transition: 'border-color 120ms ease',
                            }}
                        >
                            <Box
                                sx={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    background: s.hex,
                                    boxShadow: isSelected
                                        ? 'inset 0 0 0 2px #fff'
                                        : `inset 0 0 0 1px ${ATLAS_PALETTE.slate10}`,
                                }}
                            />
                        </Box>
                    );
                })}
            </Box>
            <Typography
                sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {selected ? `${selected.hex} · ${selected.name}` : normalized}
            </Typography>
        </Box>
    );
}
