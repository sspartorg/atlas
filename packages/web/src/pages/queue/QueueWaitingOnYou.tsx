import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import type { IAgent } from '@atlas/shared';
import { ATLAS_PALETTE, TOUCH } from '../../theme/tokens.js';
import { StatusChip } from '../../components/index.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import type { QueueItem } from './queueViewModel.js';
import { relativeTimeShort } from './queueViewModel.js';
import { getAgentView } from '../agents/agentViewModel.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    items: QueueItem[];
    agentsById: Map<string, IAgent>;
    projectNameById: Map<string, string>;
}

export function QueueWaitingOnYou({ items, agentsById, projectNameById }: Props) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const cols = '90px 1fr 220px 110px 100px';

    function handleOpen(it: QueueItem) {
        if (it.type === 'story') navigate(`/issues/stories/${it.id}`);
        else if (it.type === 'bug') navigate(`/issues`);
        else if (it.type === 'epic') navigate(`/epics/${it.id}`);
        else navigate(`/issues`);
    }

    return (
        <Box sx={{ mt: 8 }}>
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    alignItems: { xs: 'flex-start', md: 'baseline' },
                    gap: { xs: 0.5, md: 2 },
                    mb: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: items.length > 0 ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate60,
                    }}
                >
                    Waiting on You
                    <Box
                        component="span"
                        sx={{
                            ml: 1,
                            fontWeight: 500,
                            color:
                                items.length > 0 ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate30,
                        }}
                    >
                        {items.length}
                    </Box>
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {items.length === 0
                        ? 'only humans block — agents never wait on each other.'
                        : 'only humans block — agents cannot reply for you.'}
                </Typography>
            </Box>

            {items.length === 0 ? (
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        py: 12,
                        px: 6,
                        textAlign: 'center',
                    }}
                >
                    {/* Mercury collapses `ATLAS_PALETTE.green` to the
                        accent slot (black in light / white in dark), and
                        hexToRgba(...) can't tint a CSS-var string, so the
                        old code painted a SOLID black or white circle here.
                        successSoft / success are the semantic green slots
                        that keep their actual hue across both themes. */}
                    <Box
                        sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '9999px',
                            background: ATLAS_PALETTE.successSoft,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mb: 3,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 28, color: ATLAS_PALETTE.success }}
                        >
                            check_circle
                        </Box>
                    </Box>
                    <Typography
                        sx={{ fontSize: 18, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 1 }}
                    >
                        Nothing Waiting on You
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        No agent has escalated for human input.
                    </Typography>
                </Box>
            ) : isMobile ? (
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        overflow: 'hidden',
                    }}
                >
                    {items.map((it, i) => {
                        const agent = it.assignee_agent_id
                            ? (agentsById.get(it.assignee_agent_id) ?? null)
                            : null;
                        const view = agent ? getAgentView(agent) : null;
                        const projectName = it.project_id
                            ? projectNameById.get(it.project_id)
                            : null;
                        return (
                            <Box
                                key={it.id}
                                role="button"
                                onClick={() => handleOpen(it)}
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                    px: 4,
                                    py: 3,
                                    minHeight: TOUCH.rowMin,
                                    borderTop:
                                        i === 0
                                            ? 'none'
                                            : `1px solid ${ATLAS_PALETTE.slate06}`,
                                    cursor: 'pointer',
                                    transition: 'background 150ms ease',
                                    '&:active': { background: ATLAS_PALETTE.slate08 },
                                }}
                            >
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 2,
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11.5,
                                            color: ATLAS_PALETTE.brandBlue,
                                            fontWeight: 500,
                                        }}
                                    >
                                        {it.displayId}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                    >
                                        {relativeTimeShort(it.updated_at)}
                                    </Typography>
                                </Box>

                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr auto',
                                        gap: 2,
                                        alignItems: 'center',
                                    }}
                                >
                                    <Box
                                        sx={{
                                            minWidth: 0,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1.25,
                                        }}
                                    >
                                        <Typography
                                            sx={{
                                                fontSize: 15,
                                                fontWeight: 600,
                                                color: ATLAS_PALETTE.slate,
                                                lineHeight: 1.35,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                        >
                                            {it.title}
                                        </Typography>

                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.25,
                                                minWidth: 0,
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    fontSize: 12,
                                                    color: ATLAS_PALETTE.slate60,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    minWidth: 0,
                                                }}
                                            >
                                                {projectName ?? '—'}
                                            </Typography>
                                            <Box sx={{ flexShrink: 0 }}>
                                                <StatusChip
                                                    status={it.status as string}
                                                    size="sm"
                                                />
                                            </Box>
                                        </Box>

                                        {agent && (
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 1.25,
                                                    minWidth: 0,
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 22,
                                                        height: 22,
                                                        borderRadius: '9999px',
                                                        background: agent.accent_color,
                                                        color: ATLAS_PALETTE.white,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    <Box
                                                        component="span"
                                                        className="material-symbols-rounded"
                                                        sx={{ fontSize: 13 }}
                                                    >
                                                        {view?.glyph ?? 'developer_board'}
                                                    </Box>
                                                </Box>
                                                <Typography
                                                    sx={{
                                                        fontSize: 12.5,
                                                        color: ATLAS_PALETTE.slate,
                                                        fontWeight: 500,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    {agent.name}
                                                </Typography>
                                                <Typography
                                                    sx={{
                                                        fontSize: 12,
                                                        color: ATLAS_PALETTE.slate60,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    asked
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>

                                    <IconButton
                                        size="medium"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpen(it);
                                        }}
                                        aria-label="Reply"
                                        sx={{
                                            width: TOUCH.iconButton,
                                            height: TOUCH.iconButton,
                                            background: ATLAS_PALETTE.brandBlue,
                                            color: ATLAS_PALETTE.onAccent,
                                            flexShrink: 0,
                                            '&:hover': {
                                                background: ATLAS_PALETTE.greenDark,
                                            },
                                        }}
                                    >
                                        <Box
                                            component="span"
                                            className="material-symbols-rounded"
                                            sx={{ fontSize: 18 }}
                                        >
                                            reply
                                        </Box>
                                    </IconButton>
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            ) : (
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        overflow: 'hidden',
                    }}
                >
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: cols,
                            gap: 3,
                            alignItems: 'center',
                            px: 4,
                            py: 2,
                            background: ATLAS_PALETTE.slate06,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        }}
                    >
                        {['ID', 'Item', 'Agent Asked', 'Asked Time', 'Reply'].map((h) => (
                            <Typography
                                key={h}
                                sx={{
                                    fontSize: 10.5,
                                    fontWeight: 500,
                                    letterSpacing: '.06em',
                                    textTransform: 'uppercase',
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                {h}
                            </Typography>
                        ))}
                    </Box>
                    {items.map((it) => {
                        const agent = it.assignee_agent_id
                            ? (agentsById.get(it.assignee_agent_id) ?? null)
                            : null;
                        const view = agent ? getAgentView(agent) : null;
                        const projectName = it.project_id
                            ? projectNameById.get(it.project_id)
                            : null;
                        return (
                            <Box
                                key={it.id}
                                onClick={() => handleOpen(it)}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: cols,
                                    gap: 3,
                                    alignItems: 'center',
                                    px: 4,
                                    py: 3,
                                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                                    cursor: 'pointer',
                                    transition: 'background 150ms ease',
                                    '&:hover': { background: ATLAS_PALETTE.slate06 },
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11.5,
                                        color: ATLAS_PALETTE.brandBlue,
                                    }}
                                >
                                    {it.displayId}
                                </Typography>
                                <Box>
                                    <Typography
                                        sx={{
                                            fontSize: 14,
                                            color: ATLAS_PALETTE.slate,
                                            fontWeight: 500,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {it.title}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontSize: 11.5,
                                            color: ATLAS_PALETTE.slate60,
                                            mt: 0.25,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                        }}
                                    >
                                        {projectName ?? '—'}
                                        <StatusChip status={it.status as string} size="sm" />
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    {agent ? (
                                        <>
                                            <Box
                                                sx={{
                                                    width: 22,
                                                    height: 22,
                                                    borderRadius: '9999px',
                                                    background: agent.accent_color,
                                                    color: ATLAS_PALETTE.white,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <Box
                                                    component="span"
                                                    className="material-symbols-rounded"
                                                    sx={{ fontSize: 13 }}
                                                >
                                                    {view?.glyph ?? 'developer_board'}
                                                </Box>
                                            </Box>
                                            <Typography
                                                sx={{
                                                    fontSize: 12.5,
                                                    color: ATLAS_PALETTE.slate,
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {agent.name}
                                            </Typography>
                                        </>
                                    ) : (
                                        <Typography
                                            sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}
                                        >
                                            —
                                        </Typography>
                                    )}
                                </Box>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11.5,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {relativeTimeShort(it.updated_at)}
                                </Typography>
                                <Button
                                    variant="contained"
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpen(it);
                                    }}
                                    sx={{
                                        fontSize: 12,
                                        textTransform: 'none',
                                        background: ATLAS_PALETTE.brandBlue,
                                        color: ATLAS_PALETTE.onAccent,
                                        boxShadow: 'none',
                                        '&:hover': {
                                            background: ATLAS_PALETTE.greenDark,
                                            boxShadow: 'none',
                                        },
                                    }}
                                    startIcon={
                                        <Box
                                            component="span"
                                            className="material-symbols-rounded"
                                            sx={{ fontSize: 16 }}
                                        >
                                            reply
                                        </Box>
                                    }
                                >
                                    Reply
                                </Button>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
}
