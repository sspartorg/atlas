import { useMemo } from 'react';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { AgentCli } from '@atlas/shared';
import { useCliModels } from '../hooks/useCliModels.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';

interface Props {
    cli: AgentCli;
    value: string;
    onChange: (next: string) => void;
    /** When true, render with a floating `Label`; otherwise embed unlabelled
     *  inside an existing form row. */
    showLabel?: boolean | undefined;
    fullWidth?: boolean | undefined;
    /** Sizing variant — `dense` matches the OverviewTab CLI dropdown
     *  (180px min-width, mono-font value), `dialog` matches the New-Agent
     *  modal field (form-control min-width 0, full width, normal padding). */
    size?: 'dense' | 'dialog' | undefined;
}

const MENU_PROPS = {
    slotProps: {
        paper: {
            sx: { maxHeight: 320 },
        },
    },
} as const;

export function ModelSelect({
    cli,
    value,
    onChange,
    showLabel = false,
    fullWidth = true,
    size = 'dense',
}: Props) {
    const { data: allModels = [] } = useCliModels();

    const options = useMemo(
        () =>
            allModels
                .filter((m) => m.cli === cli)
                .sort((a, b) => a.sort_order - b.sort_order || a.model_name.localeCompare(b.model_name)),
        [allModels, cli]
    );

    const valueIsKnown = options.some((m) => m.model_name === value);
    const hasOptions = options.length > 0;

    const selectSx =
        size === 'dialog'
            ? {
                  fontSize: 13.5,
              }
            : {
                  fontSize: 13.5,
                  minWidth: 180,
                  '& .MuiOutlinedInput-input': {
                      fontFamily: TYPOGRAPHY.fontFamilyMono,
                      fontSize: 12.5,
                      py: 1,
                  },
              };

    const labelProps = showLabel
        ? ({ labelId: `model-select-${cli}`, label: 'Model' } as const)
        : {};

    return (
        <FormControl fullWidth={fullWidth} size={size === 'dense' ? 'small' : 'medium'}>
            {showLabel && <InputLabel id={`model-select-${cli}`}>Model</InputLabel>}
            <Select
                {...labelProps}
                value={hasOptions ? value : ''}
                onChange={(e) => onChange(e.target.value)}
                displayEmpty
                MenuProps={MENU_PROPS}
                sx={selectSx}
                renderValue={(v) => {
                    const str = String(v ?? '');
                    if (!str) {
                        return (
                            <Typography
                                component="span"
                                sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40 }}
                            >
                                {hasOptions
                                    ? 'Pick a model…'
                                    : 'No models registered for this CLI'}
                            </Typography>
                        );
                    }
                    return str;
                }}
            >
                {!hasOptions && (
                    <MenuItem disabled value="">
                        No models registered for this CLI
                    </MenuItem>
                )}
                {options.map((m) => (
                    <MenuItem key={m.id} value={m.model_name} sx={{ fontSize: 13 }}>
                        {m.model_name}
                        {m.note && (
                            <Typography
                                component="span"
                                sx={{
                                    ml: 1,
                                    color: ATLAS_PALETTE.slate40,
                                    fontSize: 11,
                                }}
                            >
                                · {m.note}
                            </Typography>
                        )}
                    </MenuItem>
                ))}
                {!valueIsKnown && value && hasOptions && (
                    <MenuItem disabled value={value}>
                        {value}{' '}
                        <Typography
                            component="span"
                            sx={{ ml: 1, color: ATLAS_PALETTE.slate40, fontSize: 11 }}
                        >
                            · current (not in registry)
                        </Typography>
                    </MenuItem>
                )}
            </Select>
        </FormControl>
    );
}
