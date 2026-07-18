import { useState } from 'react';
import type React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import type { IAgent } from '@atlas/shared';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { agentSubtitle } from '../pages/agents/agentViewModel.js';
import { InitialAvatar } from './InitialAvatar.js';

interface Props {
    assigneeAgentId: string | null;
    onAssign: (agentId: string | null) => void;
    loading?: boolean;
}

export function ReassignControl({ assigneeAgentId, onAssign, loading }: Props) {
    const [anchor, setAnchor] = useState<null | HTMLElement>(null);
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();

    const assignee = agents.find((w) => w.id === assigneeAgentId);
    const ownerName = settings?.owner_name ?? 'Owner';

    const activeAgents = agents.filter((w: IAgent) => w.status === 'active');

    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, flexShrink: 0 }}>
                    Assigned to
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => setAnchor(e.currentTarget)}
                    disabled={Boolean(loading)}
                    startIcon={
                        <Box
                            sx={{
                                width: 16,
                                height: 16,
                                borderRadius: '9999px',
                                background: assignee?.accent_color ?? ATLAS_PALETTE.slate,
                                flexShrink: 0,
                            }}
                        />
                    }
                    sx={{
                        height: 28,
                        fontSize: 12,
                        textTransform: 'none',
                        fontFamily: '"Inter", system-ui, sans-serif',
                        borderColor: ATLAS_PALETTE.slate12,
                        color: assignee?.accent_color ?? ATLAS_PALETTE.slate60,
                    }}
                >
                    {assignee?.name ?? ownerName}
                </Button>
            </Box>

            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                PaperProps={{
                    sx: {
                        background: ATLAS_PALETTE.surfaceRaised,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '10px',
                        boxShadow: 'var(--atlas-elevation-overlay)',
                        minWidth: 200,
                    },
                }}
            >
                <MenuItem
                    onClick={() => {
                        onAssign(null);
                        setAnchor(null);
                    }}
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate,
                        gap: 2,
                        '&:hover': { background: ATLAS_PALETTE.slate08 },
                    }}
                >
                    <InitialAvatar
                        name={ownerName}
                        color={ATLAS_PALETTE.slate}
                        size={20}
                        fontSize={10}
                    />
                    {ownerName} (Owner)
                </MenuItem>

                {activeAgents.map((w) => (
                    <MenuItem
                        key={w.id}
                        onClick={() => {
                            onAssign(w.id);
                            setAnchor(null);
                        }}
                        sx={{
                            fontSize: 13,
                            color: w.accent_color,
                            gap: 2,
                            py: 1.25,
                            '&:hover': { background: ATLAS_PALETTE.slate08 },
                        }}
                    >
                        <InitialAvatar
                            name={w.name}
                            color={w.accent_color}
                            size={20}
                            fontSize={10}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: w.accent_color,
                                    lineHeight: 1.3,
                                }}
                            >
                                {w.name}
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    lineHeight: 1.3,
                                }}
                            >
                                {agentSubtitle(w)}
                            </Typography>
                        </Box>
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}
