import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import { cliIcon } from '../utils/cliIcons.js';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import type { ICliSession, CliSessionStatus } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import {
    TerminalSessionControls,
    useTerminalStopModal,
} from './TerminalSessionControls.js';
import { useNavigate } from 'react-router-dom';
import { sessionDetailUrl } from '../utils/cliSessionRouting.js';

const STATUS_DOT_COLOR: Record<CliSessionStatus, string> = {
    active: ATLAS_PALETTE.success,
    paused: ATLAS_PALETTE.warning,
    closed: ATLAS_PALETTE.slate30,
    errored: ATLAS_PALETTE.error,
};

interface PaneChromeProps {
    session: ICliSession;
    onDetach: () => void;
    onStopped?: () => void;
}

export function PaneChrome({ session, onDetach, onStopped }: PaneChromeProps) {
    const navigate = useNavigate();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    // The stop modal lives at PaneChrome scope so it survives the kebab Menu
    // closing — otherwise the Menu's ~225ms exit would unmount the modal
    // mid-preflight and Stop-from-kebab would silently fail.
    const { stopRequest, stopModalElement } = useTerminalStopModal(session, onStopped);

    const CliIcon = cliIcon(session.cli);

    return (
        <Box
            sx={{
                height: 32,
                px: 1.25,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate12}`,
                background: ATLAS_PALETTE.surfaceRaised,
                flexShrink: 0,
                minWidth: 0,
            }}
        >
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: STATUS_DOT_COLOR[session.status],
                    flexShrink: 0,
                }}
                title={session.status}
            />
            <CliIcon sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }} />
            <Typography
                noWrap
                sx={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: ATLAS_PALETTE.slate,
                    flex: 1,
                    minWidth: 0,
                }}
            >
                {session.title}
            </Typography>
            <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ p: 0.25 }}>
                <MoreVertRounded sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
                <TerminalSessionControls
                    session={session}
                    compact
                    onMenuItemClick={close}
                    onStopRequest={stopRequest}
                />
                <Divider />
                <MenuItem
                    onClick={() => {
                        close();
                        navigate(sessionDetailUrl(session));
                    }}
                >
                    <ListItemIcon>
                        <OpenInNewRounded fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Open in single view</ListItemText>
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        close();
                        onDetach();
                    }}
                >
                    <ListItemIcon>
                        <LinkOffRounded fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Detach pane (keep session)</ListItemText>
                </MenuItem>
            </Menu>
            {stopModalElement}
        </Box>
    );
}
