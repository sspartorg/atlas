import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import type { IProject } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ProjectRowMenu } from './ProjectRowMenu.js';

const MONO_FONT = '"JetBrains Mono", monospace';

interface IProjectCardProps {
    project: IProject;
    displayId: string;
    epicCount: number;
    storyCount: number;
    scheduleInfo?: { preset: string; next_run_at: string | null } | undefined;
    onOpen: () => void;
    onCopyUrl: () => void;
    onReclone: () => void;
    onDelete: () => void;
    onScheduleFetch: () => void;
}

import { relativeTime } from '../../utils/time.js';

function Counter({ value, label }: { value: number | null; label: string }) {
    return (
        <Stack direction="row" spacing={1} alignItems="baseline">
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                {value === null ? '—' : value}
            </Typography>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{label}</Typography>
        </Stack>
    );
}

export function ProjectCard({
    project,
    displayId,
    epicCount,
    storyCount,
    scheduleInfo,
    onOpen,
    onCopyUrl,
    onReclone,
    onDelete,
    onScheduleFetch,
}: IProjectCardProps) {
    return (
        <Paper
            elevation={0}
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                p: 6,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
            }}
        >
            {/* Header row */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                    <Box
                        sx={{
                            width: 32,
                            height: 32,
                            borderRadius: '12px',
                            bgcolor: ATLAS_PALETTE.cloud,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <FolderOpenRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 18 }} />
                    </Box>
                    <Typography
                        variant="h3"
                        sx={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {project.name}
                    </Typography>
                    {scheduleInfo && (
                        <Tooltip
                            title={`Auto-fetch: ${scheduleInfo.preset}${
                                scheduleInfo.next_run_at
                                    ? ` · next ${new Date(scheduleInfo.next_run_at).toLocaleString()}`
                                    : ''
                            }`}
                        >
                            <ScheduleRounded
                                aria-label="Auto-fetch enabled"
                                sx={{ fontSize: 16, color: ATLAS_PALETTE.success, flexShrink: 0 }}
                            />
                        </Tooltip>
                    )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <Chip
                        size="small"
                        label={displayId}
                        sx={{
                            bgcolor: ATLAS_PALETTE.slate08,
                            color: ATLAS_PALETTE.slate60,
                            fontFamily: MONO_FONT,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            height: 22,
                            minWidth: 56,
                            '& .MuiChip-label': { px: 1.5 },
                        }}
                    />
                    <ProjectRowMenu
                        onOpen={onOpen}
                        onCopyUrl={onCopyUrl}
                        onReclone={onReclone}
                        onDelete={onDelete}
                        onScheduleFetch={onScheduleFetch}
                    />
                </Box>
            </Box>

            {/* Repo URL (host + path only — drops https://, .git) */}
            <Tooltip title={project.git_path || ''}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 4, minWidth: 0 }}>
                    <LinkRounded
                        sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60, flexShrink: 0 }}
                    />
                    <Typography
                        sx={{
                            fontFamily: MONO_FONT,
                            fontSize: 13,
                            color: ATLAS_PALETTE.slate60,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {project.git_url
                            ? project.git_url.replace(/^https?:\/\//, '').replace(/\.git\/?$/, '')
                            : '—'}
                    </Typography>
                </Box>
            </Tooltip>

            {/* Counters */}
            <Stack direction="row" spacing={4} sx={{ mt: 4 }}>
                <Counter value={epicCount} label="epics" />
                <Counter value={storyCount} label="stories" />
            </Stack>

            {/* Divider */}
            <Box sx={{ borderTop: `1px solid ${ATLAS_PALETTE.slate08}`, mt: 4, mb: 4 }} />

            {/* Footer */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mt: 'auto',
                }}
            >
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    Last activity {relativeTime(project.last_activity_at)}
                </Typography>
                <Box
                    component={RouterLink}
                    to={`/projects/${project.id}`}
                    sx={{
                        color: ATLAS_PALETTE.brandBlue,
                        fontWeight: 600,
                        fontSize: 13,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                    }}
                >
                    Open →
                </Box>
            </Box>
        </Paper>
    );
}
