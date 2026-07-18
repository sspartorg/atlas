import { memo, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import type { IAgent } from '@atlas/shared';
import { useUpdateAgent } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { AgentCardMenu, type AgentCardMenuActions } from './AgentCardMenu.js';
import { LiveDot } from '../../components/LiveDot.js';
import {
    agentSubtitle,
    relativeTime,
    type AgentView,
    type AgentRuntimeStats,
} from './agentViewModel.js';

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

interface Props {
    agent: IAgent;
    view: AgentView;
    stats: AgentRuntimeStats;
    onRunNow: () => void;
    onPauseToggle: () => void;
    menuActions: AgentCardMenuActions;
}

export const AgentHero = memo(function AgentHero({
    agent,
    view,
    stats,
    onRunNow,
    onPauseToggle,
    menuActions,
}: Props) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(agent.name);
    const titleInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!editingTitle) setTitleDraft(agent.name);
    }, [agent.name, editingTitle]);

    useEffect(() => {
        if (editingTitle) titleInputRef.current?.select();
    }, [editingTitle]);

    function commitTitle() {
        const next = titleDraft.trim();
        if (!next || next === agent.name) {
            setTitleDraft(agent.name);
            setEditingTitle(false);
            return;
        }
        updateAgent.mutate(
            { id: agent.id, data: { name: next } },
            {
                onSuccess: () => {
                    toast.show({ message: 'Agent renamed' });
                    setEditingTitle(false);
                },
                onError: (e) => {
                    toast.show({ message: 'Rename failed', detail: (e as Error).message });
                    setTitleDraft(agent.name);
                },
            }
        );
    }

    const isPaused = agent.status === 'inactive';
    const statusLabel = isPaused ? 'Paused' : stats.queueDepth > 0 ? 'Queued' : 'Running';
    // Use the semantic slots (`success`, `warning`) — Mercury collapses
    // `green` and `gold` to brand-accent (black/white) so they can't carry
    // a live/queued signal.
    const statusColor = isPaused
        ? ATLAS_PALETTE.slate60
        : statusLabel === 'Queued'
          ? ATLAS_PALETTE.warning
          : ATLAS_PALETTE.success;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 4,
                mb: 4,
                flexWrap: 'wrap',
            }}
        >
            <Box sx={{ display: 'flex', gap: 2.5, flex: 1, minWidth: 0 }}>
                <Box
                    sx={{
                        width: 52,
                        height: 52,
                        borderRadius: '12px',
                        background: hexToRgba(agent.accent_color, 0.14),
                        border: `1px solid ${hexToRgba(agent.accent_color, 0.28)}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 28, color: agent.accent_color }}
                    >
                        {view.glyph}
                    </Box>
                </Box>

                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            flexWrap: 'wrap',
                            mb: 1,
                        }}
                    >
                        {editingTitle ? (
                            <TextField
                                inputRef={titleInputRef}
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onBlur={commitTitle}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitTitle();
                                    if (e.key === 'Escape') {
                                        setTitleDraft(agent.name);
                                        setEditingTitle(false);
                                    }
                                }}
                                size="small"
                                autoFocus
                                disabled={updateAgent.isPending}
                                inputProps={{ maxLength: 100 }}
                                sx={{
                                    flex: '1 1 220px',
                                    minWidth: 220,
                                    maxWidth: '100%',
                                    '& .MuiOutlinedInput-input': {
                                        fontSize: '1.6rem',
                                        fontWeight: 700,
                                        py: 0.5,
                                        color: ATLAS_PALETTE.slate,
                                    },
                                }}
                            />
                        ) : (
                            <Box
                                onClick={() => setEditingTitle(true)}
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    cursor: 'pointer',
                                    borderRadius: '6px',
                                    px: 0.5,
                                    mx: -0.5,
                                    // Allow the title block to shrink inside
                                    // the flex parent and bound it at 100%
                                    // of the available row width so a long
                                    // agent name truncates instead of pushing
                                    // the category chip / hero meta off-screen.
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    '&:hover': { background: ATLAS_PALETTE.slate06 },
                                    '&:hover .agent-title-edit-icon': { opacity: 1 },
                                }}
                            >
                                <Typography
                                    title={agent.name}
                                    sx={{
                                        fontSize: '2rem',
                                        fontWeight: 700,
                                        color: ATLAS_PALETTE.slate,
                                        lineHeight: 1.15,
                                        letterSpacing: '-0.01em',
                                        minWidth: 0,
                                        maxWidth: '100%',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}
                                >
                                    {agent.name}
                                </Typography>
                                <IconButton
                                    size="small"
                                    className="agent-title-edit-icon"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingTitle(true);
                                    }}
                                    sx={{
                                        opacity: 0,
                                        flexShrink: 0,
                                        color: ATLAS_PALETTE.slate60,
                                        transition: 'opacity 120ms ease',
                                    }}
                                    aria-label="Rename agent"
                                >
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 18 }}
                                    >
                                        edit
                                    </Box>
                                </IconButton>
                            </Box>
                        )}
                    </Box>

                    <Typography
                        sx={{
                            fontSize: 13,
                            color: ATLAS_PALETTE.slate60,
                            mb: 1,
                            lineHeight: 1.3,
                        }}
                    >
                        {agentSubtitle(agent)}
                    </Typography>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            {statusLabel === 'Running' ? (
                                <LiveDot size={9} hex={statusColor} label={statusLabel} />
                            ) : (
                                <Box
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '9999px',
                                        background: statusColor,
                                    }}
                                />
                            )}
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: statusColor }}>
                                {statusLabel}
                            </Typography>
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 13,
                                color: ATLAS_PALETTE.brandBlue,
                                cursor: 'pointer',
                            }}
                        >
                            Queue: <strong>{stats.queueDepth}</strong> item
                            {stats.queueDepth === 1 ? '' : 's'}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Last run: {stats.lastRunAt ? relativeTime(stats.lastRunAt) : '—'}
                        </Typography>
                    </Box>
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: { xs: '100%', md: 'auto' },
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                }}
            >
                <Button
                    variant="contained"
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            play_arrow
                        </Box>
                    }
                    onClick={onRunNow}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 13.5,
                        px: 2.5,
                        py: 1,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    Run now
                </Button>
                <Button
                    variant="outlined"
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            {isPaused ? 'play_arrow' : 'pause'}
                        </Box>
                    }
                    onClick={onPauseToggle}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: 13.5,
                        color: ATLAS_PALETTE.slate,
                        borderColor: ATLAS_PALETTE.slate12,
                        bgcolor: ATLAS_PALETTE.white,
                        px: 2.5,
                        py: 1,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.slate30,
                            bgcolor: ATLAS_PALETTE.slate08,
                        },
                    }}
                >
                    {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <AgentCardMenu actions={{ ...menuActions, paused: isPaused }} />
            </Box>
        </Box>
    );
});
