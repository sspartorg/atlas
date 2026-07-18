import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { IAgent } from '@atlas/shared';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { agentSubtitle } from '../pages/agents/agentViewModel.js';
import { InitialAvatar } from './InitialAvatar.js';

interface Props {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    assigneeAgentId: string | null;
    onAssign: (agentId: string | null) => void;
}

function Initial({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
    return <InitialAvatar name={name} color={color} size={size} />;
}

export function AssigneePickerPopover({
    anchorEl,
    open,
    onClose,
    assigneeAgentId,
    onAssign,
}: Props) {
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();
    const ownerName = settings?.owner_name ?? 'Owner';
    const ownerAccent = settings?.accent_color ?? ATLAS_PALETTE.slate;

    const activeAgents = agents.filter((w: IAgent) => w.status === 'active');

    return (
        <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
                paper: {
                    sx: {
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '10px',
                        boxShadow: '0 12px 32px rgba(0,0,14,.12)',
                        minWidth: 220,
                        mt: 1,
                    },
                },
            }}
        >
            <MenuItem
                onClick={() => {
                    onAssign(null);
                    onClose();
                }}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    py: 1.5,
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                }}
            >
                <Initial name={ownerName} color={ownerAccent} />
                <Box sx={{ flex: 1 }}>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: ownerAccent,
                            lineHeight: 1.3,
                        }}
                    >
                        {ownerName}
                    </Typography>
                    <Typography
                        sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, lineHeight: 1.3 }}
                    >
                        Owner
                    </Typography>
                </Box>
                {assigneeAgentId === null && (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.brandBlue }}
                    >
                        check
                    </Box>
                )}
            </MenuItem>

            {activeAgents.map((w) => (
                <MenuItem
                    key={w.id}
                    onClick={() => {
                        onAssign(w.id);
                        onClose();
                    }}
                    sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}
                >
                    <Initial name={w.name} color={w.accent_color} />
                    <Box sx={{ flex: 1 }}>
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
                            sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, lineHeight: 1.3 }}
                        >
                            AI · {agentSubtitle(w)}
                        </Typography>
                    </Box>
                    {assigneeAgentId === w.id && (
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18, color: ATLAS_PALETTE.brandBlue }}
                        >
                            check
                        </Box>
                    )}
                </MenuItem>
            ))}
        </Menu>
    );
}
