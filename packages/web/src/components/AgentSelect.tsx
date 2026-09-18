import { useMemo } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent, SdlcRole } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// Searchable assignee picker used by TaskNew.
// Each row shows: accent dot + agent name + designation (or category fallback
// for the Owner row / agents missing designation). Search matches against
// both name and designation.

export interface AgentSelectOption {
    type: 'owner' | 'agent';
    id: string; // 'OWNER' for the owner row, agent.id otherwise
    name: string;
    designation: string;
    accent_color: string;
    suggested?: boolean;
}

interface Props {
    agents: IAgent[];
    /** Stable id value owned by the parent: 'OWNER', '' (unselected), or an agent id. */
    value: string;
    onChange: (value: string) => void;
    /** When provided, Owner appears as the first option with id 'OWNER'. */
    ownerName?: string | undefined;
    placeholder?: string | undefined;
    /** MUI floating label rendered by the inner TextField. Omit when the
     *  caller renders its own external Typography label above the field —
     *  but then pass `ariaLabel`, or the input ends up with no accessible
     *  name at all (an external <Typography> is not associated with it). */
    label?: string | undefined;
    /** Accessible name for the inner input. Use when `label` is omitted
     *  because the caller draws its own visual label. */
    ariaLabel?: string | undefined;
    /** Forwarded to Autocomplete so callers can control size in dense forms. */
    size?: 'small' | 'medium';
    /** Agents with this role_id are listed first under a "Suggested" group. */
    suggestedRole?: SdlcRole | undefined;
}

const filterOptions = createFilterOptions<AgentSelectOption>({
    stringify: (option) => `${option.name} ${option.designation}`,
});

export function AgentSelect({
    agents,
    value,
    onChange,
    ownerName,
    placeholder,
    label,
    ariaLabel,
    size = 'medium',
    suggestedRole,
}: Props) {
    const options = useMemo<AgentSelectOption[]>(() => {
        const opts: AgentSelectOption[] = [];
        if (ownerName) {
            opts.push({
                type: 'owner',
                id: 'OWNER',
                name: ownerName,
                designation: 'Owner',
                accent_color: ATLAS_PALETTE.slate,
            });
        }
        const suggested: AgentSelectOption[] = [];
        for (const a of agents) {
            const opt: AgentSelectOption = {
                type: 'agent',
                id: a.id,
                name: a.name,
                designation: a.designation || 'AI',
                accent_color: a.accent_color,
            };
            if (suggestedRole && a.role_id === suggestedRole) suggested.push({ ...opt, suggested: true });
            else opts.push(opt);
        }
        return [...suggested, ...opts];
    }, [agents, ownerName, suggestedRole]);
    const hasSuggested = options.some((o) => o.suggested);

    const selected = options.find((o) => o.id === value) ?? null;

    return (
        <Autocomplete
            options={options}
            value={selected}
            onChange={(_, v) => onChange(v?.id ?? '')}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={filterOptions}
            {...(hasSuggested
                ? { groupBy: (o: AgentSelectOption) => (o.suggested ? 'Suggested' : 'Everyone else') }
                : {})}
            // When Owner is in the list, clearing has no useful meaning — Owner is
            // the neutral fallback. Without an Owner option, allow clearing (the
            // parent treats empty as "no assignee yet" and converts to null on
            // submit).
            disableClearable={Boolean(ownerName)}
            size={size}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    placeholder={placeholder ?? 'Pick an assignee…'}
                    inputProps={{
                        ...params.inputProps,
                        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
                    }}
                    InputProps={{
                        ...params.InputProps,
                        startAdornment: selected ? (
                            <Box
                                sx={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: '50%',
                                    background: selected.accent_color,
                                    ml: 1,
                                    mr: 0.5,
                                    flexShrink: 0,
                                }}
                            />
                        ) : null,
                    }}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            background: ATLAS_PALETTE.white,
                            fontSize: 13,
                            fontFamily: '"Inter", system-ui, sans-serif',
                        },
                    }}
                />
            )}
            renderOption={(props, option) => {
                const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & {
                    key: string;
                };
                return (
                    <Box
                        component="li"
                        key={key}
                        {...rest}
                        sx={{
                            display: 'flex !important',
                            alignItems: 'center',
                            gap: 1.5,
                            py: 1,
                        }}
                    >
                        <Box
                            sx={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: option.accent_color,
                                flexShrink: 0,
                            }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: ATLAS_PALETTE.slate,
                                    lineHeight: 1.3,
                                }}
                            >
                                {option.name}
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    lineHeight: 1.3,
                                }}
                            >
                                {option.designation}
                            </Typography>
                        </Box>
                    </Box>
                );
            }}
        />
    );
}
