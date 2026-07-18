import { useRef, useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export interface AgentCardMenuActions {
    onOpen?: () => void;
    onEdit?: () => void;
    onDuplicate?: () => void;
    onPause?: () => void;
    onDelete?: () => void;
    onExport?: () => void;
    paused?: boolean;
}

export function AgentCardMenu({ actions }: { actions: AgentCardMenuActions }) {
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLDivElement | null>(null);

    function handleTrigger(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
    }

    function run(fn?: () => void) {
        return (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            fn?.();
        };
    }

    return (
        <>
            <Box
                ref={anchorRef}
                onClick={handleTrigger}
                sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: ATLAS_PALETTE.slate60,
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                    '&:hover': { background: ATLAS_PALETTE.slate08, color: ATLAS_PALETTE.slate },
                }}
            >
                <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 20 }}>
                    more_vert
                </Box>
            </Box>

            <Menu
                anchorEl={anchorRef.current}
                open={open}
                onClose={() => setOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{
                    paper: {
                        sx: {
                            minWidth: 160,
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            boxShadow: '0 8px 24px rgba(0,0,14,.10)',
                            mt: 0.5,
                        },
                    },
                }}
            >
                {actions.onOpen ? (
                    <MenuItem onClick={run(actions.onOpen)}>
                        <ListItemIcon>
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                            >
                                open_in_new
                            </Box>
                        </ListItemIcon>
                        <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
                            Open
                        </ListItemText>
                    </MenuItem>
                ) : null}
                {actions.onEdit ? (
                    <MenuItem onClick={run(actions.onEdit)}>
                        <ListItemIcon>
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                            >
                                edit
                            </Box>
                        </ListItemIcon>
                        <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
                            Edit
                        </ListItemText>
                    </MenuItem>
                ) : null}
                <MenuItem onClick={run(actions.onDuplicate)}>
                    <ListItemIcon>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                        >
                            content_copy
                        </Box>
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Duplicate</ListItemText>
                </MenuItem>
                {actions.onExport ? (
                    <MenuItem onClick={run(actions.onExport)}>
                        <ListItemIcon>
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                            >
                                download
                            </Box>
                        </ListItemIcon>
                        <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
                            Export zip
                        </ListItemText>
                    </MenuItem>
                ) : null}
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={run(actions.onPause)}>
                    <ListItemIcon>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                        >
                            {actions.paused ? 'play_arrow' : 'pause'}
                        </Box>
                    </ListItemIcon>
                    <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
                        {actions.paused ? 'Resume' : 'Pause'}
                    </ListItemText>
                </MenuItem>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={run(actions.onDelete)}>
                    <ListItemIcon>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18, color: ATLAS_PALETTE.error }}
                        >
                            delete
                        </Box>
                    </ListItemIcon>
                    <ListItemText
                        primaryTypographyProps={{ fontSize: 13, color: ATLAS_PALETTE.error }}
                    >
                        Delete
                    </ListItemText>
                </MenuItem>
            </Menu>
        </>
    );
}
