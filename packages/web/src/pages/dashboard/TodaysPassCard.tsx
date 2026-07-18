import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, ELEVATION } from '../../theme/tokens.js';
import type { TodaysPassItem } from '../../api/types.js';

interface ITodaysPassCardProps {
    label: string;
    color: string;
    icon: string;
    items: TodaysPassItem[];
}

const MONO_FONT = '"JetBrains Mono", monospace';

function shortIssueId(item: TodaysPassItem): string {
    const prefix = item.issue_type === 'epic' ? 'EPC' : item.issue_type === 'bug' ? 'BUG' : 'STR';
    const tail = item.issue_id.split('-').slice(-1)[0] ?? item.issue_id;
    return `${prefix}-${tail.slice(0, 6).toUpperCase()}`;
}

export function TodaysPassCard({ label, color, icon, items }: ITodaysPassCardProps) {
    return (
        <Paper
            elevation={0}
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                p: 5,
                borderLeft: `4px solid ${color}`,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 20, color, lineHeight: 1 }}
                >
                    {icon}
                </Box>
                <Typography
                    sx={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color,
                    }}
                >
                    {label}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }}>
                {items.length === 0 ? (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40 }}>
                        No outputs yet today.
                    </Typography>
                ) : (
                    items.map((item) => (
                        <Box
                            key={item.run_id}
                            sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1 }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 14,
                                    color,
                                    lineHeight: 1,
                                    mt: '2px',
                                    flexShrink: 0,
                                }}
                            >
                                fiber_manual_record
                            </Box>
                            <Typography
                                sx={{ fontSize: 13, lineHeight: 1.6, color: ATLAS_PALETTE.slate }}
                            >
                                {item.agent_name}
                                {' · '}
                                <Box
                                    component="span"
                                    sx={{ fontFamily: MONO_FONT, color: ATLAS_PALETTE.slate }}
                                >
                                    {shortIssueId(item)}
                                </Box>
                            </Typography>
                        </Box>
                    ))
                )}
            </Box>
        </Paper>
    );
}
