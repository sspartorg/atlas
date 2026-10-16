import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Send from '@mui/icons-material/Send';
import { Link as RouterLink } from 'react-router-dom';
import { useSettings, isExternalChannelConnected } from '../hooks/useSettings.js';
import { useSidenavCounts } from '../hooks/useSidenavCounts.js';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';

interface INotificationStatusPopoverProps {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
}

const PROVIDER_LABEL = { telegram: 'Telegram', teams: 'Microsoft Teams' } as const;

/** The topbar Notifications pill: which channel sends, how many are unread, and the way to both pages. */
export function NotificationStatusPopover({ anchorEl, open, onClose }: INotificationStatusPopoverProps) {
    const { data: settings } = useSettings();
    const unread = useSidenavCounts().notifications;
    const connected = isExternalChannelConnected(settings);
    const provider = PROVIDER_LABEL[settings?.external_notification_provider ?? 'telegram'];
    const endpoint = settings?.external_notification_endpoint_label ?? null;

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
                    role: 'dialog',
                    'aria-label': 'Notifications status',
                    sx: {
                        mt: 1,
                        bgcolor: 'background.paper',
                        borderRadius: '8px',
                        boxShadow: ELEVATION.overlay,
                        width: 300,
                        maxWidth: 'calc(100vw - 32px)',
                        p: 4,
                    },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Send sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }} />
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {connected ? `Sending via ${provider}` : 'No external channel'}
                </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                {connected
                    ? endpoint
                        ? `Connected to ${endpoint}.`
                        : 'Set up, not tested yet.'
                    : 'In-app notifications still arrive. Connect Telegram or Microsoft Teams to get them outside Atlas too.'}
            </Typography>
            <Typography
                data-testid="popover-unread"
                sx={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: ATLAS_PALETTE.slate,
                    mt: 3,
                    pt: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate08}`,
                }}
            >
                {unread === 0
                    ? 'No unread notifications'
                    : `${unread} unread notification${unread === 1 ? '' : 's'}`}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
                <Button
                    component={RouterLink}
                    to="/notifications?tab=in-app"
                    onClick={onClose}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: 'none' }}
                >
                    Open notifications
                </Button>
                <Button
                    component={RouterLink}
                    to="/settings?tab=notifications"
                    onClick={onClose}
                    size="small"
                    sx={{ textTransform: 'none' }}
                >
                    Settings
                </Button>
            </Box>
        </Popover>
    );
}
