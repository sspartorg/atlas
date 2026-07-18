import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IEpicListItem, IProject, IAgent } from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { AgentChip } from './AgentChip.js';
import { ProjectTag } from './ProjectTag.js';
import { LiveDot } from './LiveDot.js';
import { ATLAS_PALETTE, TOUCH } from '../theme/tokens.js';

interface Props {
    rows: IEpicListItem[];
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
}

const MONO = '"JetBrains Mono", monospace';

export function MobileEpicList({
    rows,
    projects,
    agents,
    ownerName,
    ownerAccent,
}: Props) {
    const navigate = useNavigate();
    const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
    const agentsById = useMemo(() => new Map(agents.map((w) => [w.id, w])), [agents]);

    if (rows.length === 0) {
        return (
            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    py: 12,
                    textAlign: 'center',
                }}
            >
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40 }}>
                    No epics match this view.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                overflow: 'hidden',
            }}
        >
            {rows.map((row, i) => {
                const project = projectsById.get(row.project_id);
                const assignee = row.assignee_agent_id
                    ? (agentsById.get(row.assignee_agent_id) ?? null)
                    : null;
                const isLive = row.status === 'in_progress';
                return (
                    <Box
                        key={row.id}
                        role="button"
                        onClick={() => navigate(`/epics/${row.id}`)}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                            px: 4,
                            py: 3,
                            minHeight: TOUCH.rowMin,
                            borderBottom:
                                i === rows.length - 1
                                    ? 'none'
                                    : `1px solid ${ATLAS_PALETTE.slate06}`,
                            cursor: 'pointer',
                            '&:active': { background: ATLAS_PALETTE.cloud },
                        }}
                    >
                        <Box
                            sx={{
                                width: 40,
                                height: 40,
                                borderRadius: '10px',
                                background: 'rgba(0,185,255,.12)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 20, color: ATLAS_PALETTE.cerulean }}
                            >
                                flag
                            </Box>
                        </Box>
                        <Box
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1.5,
                            }}
                        >
                            {/* Row 1: title (≤2 lines) + live-dot anchored top-right */}
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                <Typography
                                    sx={{
                                        flex: 1,
                                        minWidth: 0,
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                        lineHeight: 1.35,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {row.title}
                                </Typography>
                                {isLive && (
                                    <Box sx={{ pt: '6px', flexShrink: 0 }}>
                                        <LiveDot size={8} />
                                    </Box>
                                )}
                            </Box>
                            {/* Row 2: shortId · assignee icon · status (single line) */}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1.25,
                                    flexWrap: 'nowrap',
                                    minWidth: 0,
                                    overflow: 'hidden',
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        lineHeight: 1,
                                        color: ATLAS_PALETTE.brandBlue,
                                        fontWeight: 500,
                                        flexShrink: 0,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        height: 16,
                                    }}
                                >
                                    {row.id}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 11,
                                        lineHeight: 1,
                                        color: ATLAS_PALETTE.slate40,
                                        flexShrink: 0,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        height: 16,
                                    }}
                                >
                                    ·
                                </Typography>
                                {assignee ? (
                                    <AgentChip agent={assignee} size="xs" showName={false} />
                                ) : (
                                    <AgentChip
                                        agent={{ name: ownerName, accent_color: ownerAccent }}
                                        size="xs"
                                        showName={false}
                                    />
                                )}
                                <Typography
                                    sx={{
                                        fontSize: 11,
                                        lineHeight: 1,
                                        color: ATLAS_PALETTE.slate40,
                                        flexShrink: 0,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        height: 16,
                                    }}
                                >
                                    ·
                                </Typography>
                                <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
                                    <StatusChip status={row.status} size="xs" />
                                </Box>
                            </Box>
                            {/* Row 3: project pill (Epic-only) */}
                            {project && (
                                <Box sx={{ display: 'flex', minWidth: 0 }}>
                                    <ProjectTag
                                        projectId={project.id}
                                        name={project.name}
                                        clickable
                                    />
                                </Box>
                            )}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}
