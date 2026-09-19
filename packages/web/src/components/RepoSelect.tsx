import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { IProjectRepo } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    repos: IProjectRepo[];
    /** Ordered: MUI appends each newly checked id, so order = pick order. */
    value: string[];
    onChange: (ids: string[]) => void;
}

/** ADR 0017 — picks the repos a Task works on (New Task form, Task Details rail). */
export function RepoSelect({ repos, value, onChange }: Props) {
    const nameOf = (id: string) => repos.find((r) => r.id === id)?.name ?? id;
    return (
        <FormControl fullWidth size="small">
            <Select
                multiple
                inputProps={{ 'aria-label': 'Repos' }}
                value={value}
                onChange={(e) => {
                    const next = e.target.value;
                    // A Task always works on at least one repo.
                    if (Array.isArray(next) && next.length > 0) onChange(next);
                }}
                renderValue={(ids) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {ids.map((id) => (
                            <Chip
                                key={id}
                                label={nameOf(id)}
                                size="small"
                                sx={{ fontFamily: MONO, fontSize: 11.5 }}
                            />
                        ))}
                    </Box>
                )}
                sx={{ background: ATLAS_PALETTE.white, fontSize: 13 }}
            >
                {repos.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                        <Checkbox size="small" checked={value.includes(r.id)} />
                        <ListItemText
                            primary={r.name}
                            secondary={r.primary ? 'primary' : null}
                            slotProps={{ primary: { sx: { fontFamily: MONO, fontSize: 13 } } }}
                        />
                    </MenuItem>
                ))}
            </Select>
            <FormHelperText sx={{ mx: 0 }}>
                First repo holds specs and other Task-wide files.
            </FormHelperText>
        </FormControl>
    );
}
