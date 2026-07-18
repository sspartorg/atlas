import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Send from '@mui/icons-material/Send';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';

interface INotificationStatusPopoverProps {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    connected: boolean;
}

export function NotificationStatusPopover({
    anchorEl,
    open,
    onClose,
    connected,
}: INotificationStatusPopoverProps) {
    const statusLabel = connected ? 'Sending' : 'Not configured';

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            disableRestoreFocus
            slotProps={{
                paper: {
                    sx: {
                        mt: 1,
                        bgcolor: 'background.paper',
                        borderRadius: '8px',
                        boxShadow: ELEVATION.overlay,
                        minWidth: 280,
                        p: 5,
                    },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Send sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        fontFamily: '"Inter", system-ui, sans-serif',
                    }}
                >
                    Notifications · {statusLabel}
                </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 2 }}>
                Atlas's outbound notification channel.
            </Typography>

            <Box
                sx={{
                    mt: 4,
                    pt: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate08}`,
                }}
            >
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    Teams is the only supported channel.
                </Typography>
            </Box>
        </Popover>
    );
}
