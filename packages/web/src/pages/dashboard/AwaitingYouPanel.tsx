import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import { ATLAS_PALETTE, ELEVATION } from '../../theme/tokens.js';
import type { AwaitingItem } from '../../api/types.js';
import { AwaitingYouRow } from './AwaitingYouRow.js';
import { FormHeading } from '../../components/FormHeading.js';

interface IAwaitingYouPanelProps {
    rows: AwaitingItem[];
    isLoading: boolean;
}

type FilterValue = 'all' | 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';

const MONO_FONT = '"JetBrains Mono", monospace';

export function AwaitingYouPanel({ rows, isLoading }: IAwaitingYouPanelProps) {
    const [filter, setFilter] = useState<FilterValue>('all');

    const filtered = useMemo(() => {
        if (filter === 'all') return rows;
        return rows.filter((r) => r.issue_type === filter);
    }, [rows, filter]);

    return (
        <Paper
            elevation={0}
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                p: 5,
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    // xs: title row + filter Select stacked, filter goes
                    //     full-width so it isn't crammed next to the title.
                    // sm+: title on left, filter on right, single row.
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    justifyContent: 'space-between',
                    gap: { xs: 1.5, sm: 2 },
                    minHeight: 32,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FormHeading>Awaiting You</FormHeading>
                    <Box
                        sx={{
                            bgcolor: ATLAS_PALETTE.slate06,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: MONO_FONT,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            lineHeight: 1.4,
                            minWidth: 22,
                            textAlign: 'center',
                        }}
                    >
                        {filtered.length}
                    </Box>
                </Box>
                <Select
                    size="small"
                    variant="outlined"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as FilterValue)}
                    sx={{
                        borderRadius: '6px',
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate,
                        width: { xs: '100%', sm: 'auto' },
                        '& .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.slate08,
                        },
                        '&:hover .MuiOutlinedInput-notchedOutline': {
                            borderColor: ATLAS_PALETTE.slate12,
                        },
                    }}
                >
                    <MenuItem value="all">All types</MenuItem>
                    <MenuItem value="epic">Epics</MenuItem>
                    <MenuItem value="story">Stories</MenuItem>
                    <MenuItem value="bug">Bugs</MenuItem>
                    <MenuItem value="sub_task">Sub-tasks</MenuItem>
                    <MenuItem value="sub_bug">Sub-bugs</MenuItem>
                </Select>
            </Box>

            <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`, mt: 4 }} />

            {isLoading ? (
                <Box sx={{ pt: 2 }}>
                    {[1, 2, 3].map((i) => (
                        <Skeleton
                            key={i}
                            variant="rectangular"
                            height={64}
                            sx={{ mb: 2, borderRadius: '8px' }}
                        />
                    ))}
                </Box>
            ) : filtered.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center' }}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{
                            fontSize: 48,
                            color: ATLAS_PALETTE.slate40,
                            display: 'block',
                            mb: 2,
                        }}
                    >
                        check_circle
                    </Box>
                    <Typography
                        sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate60, mb: 1 }}
                    >
                        Nothing awaiting your review
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>
                        Agents are handling everything in progress.
                    </Typography>
                </Box>
            ) : (
                <Box>
                    {filtered.map((row) => (
                        <AwaitingYouRow key={row.id} row={row} />
                    ))}
                </Box>
            )}
        </Paper>
    );
}
