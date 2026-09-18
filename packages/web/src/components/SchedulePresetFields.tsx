import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { SchedulePreset } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

const PRESETS: Array<{ value: SchedulePreset; label: string; sub: string }> = [
    { value: 'hourly', label: 'Every hour', sub: 'on the hour' },
    { value: 'every_4h', label: 'Every 4 hours', sub: '00, 04, 08…' },
    { value: 'daily', label: 'Daily', sub: 'at HH:MM local' },
    { value: 'weekly', label: 'Weekly', sub: 'Mon at 06:00' },
    { value: 'custom', label: 'Custom cron', sub: 'advanced' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface SelectableCardProps {
    title: string;
    sub: string;
    selected: boolean;
    onClick: () => void;
}

export function SelectableCard({ title, sub, selected, onClick }: SelectableCardProps) {
    return (
        <Box
            role="button"
            aria-pressed={selected}
            onClick={onClick}
            sx={{
                px: 2,
                py: 1.5,
                borderRadius: '10px',
                cursor: 'pointer',
                border: `1.5px solid ${selected ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                bgcolor: selected ? ATLAS_PALETTE.accentSoft : ATLAS_PALETTE.white,
                transition: 'background 120ms ease, border-color 120ms ease',
                '&:hover': {
                    borderColor: selected ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate30,
                    bgcolor: selected ? ATLAS_PALETTE.accentSoft : ATLAS_PALETTE.slate06,
                },
            }}
        >
            <Typography
                sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: selected ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate,
                    lineHeight: 1.2,
                }}
            >
                {title}
            </Typography>
            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.5, lineHeight: 1.3 }}>
                {sub}
            </Typography>
        </Box>
    );
}

interface SchedulePresetValue {
    preset: SchedulePreset | null;
    weekday: number | null;
    cronExpression: string;
}

interface Props {
    value: SchedulePresetValue;
    onChange: (patch: Partial<SchedulePresetValue>) => void;
    /** Preset grid columns; narrow rails pass 2. */
    columns?: number;
}

/**
 * Preset cards plus the fields a preset needs (weekday for weekly, a cron
 * expression for custom). Shared by the project auto-fetch schedule and the
 * workflow Start-node inspector so both schedule the same way.
 */
export function SchedulePresetFields({ value, onChange, columns = 3 }: Props) {
    return (
        <>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: 1.5,
                    mb: 3,
                }}
            >
                {PRESETS.map((p) => (
                    <SelectableCard
                        key={p.value}
                        title={p.label}
                        sub={p.sub}
                        selected={value.preset === p.value}
                        onClick={() => onChange({ preset: p.value })}
                    />
                ))}
            </Box>

            {value.preset === 'weekly' && (
                <TextField
                    label="Weekday"
                    select
                    value={value.weekday ?? 1}
                    onChange={(e) => onChange({ weekday: Number(e.target.value) })}
                    size="small"
                    fullWidth
                    sx={{ mb: 3 }}
                >
                    {WEEKDAYS.map((name, i) => (
                        <MenuItem key={name} value={i}>
                            {name}
                        </MenuItem>
                    ))}
                </TextField>
            )}

            {value.preset === 'custom' && (
                <TextField
                    label="Cron expression"
                    helperText="5-field standard cron (min hour dom month dow)"
                    value={value.cronExpression}
                    onChange={(e) => onChange({ cronExpression: e.target.value })}
                    fullWidth
                    size="small"
                    sx={{ mb: 3 }}
                    inputProps={{ style: { fontFamily: MONO, fontSize: 13 } }}
                />
            )}
        </>
    );
}
