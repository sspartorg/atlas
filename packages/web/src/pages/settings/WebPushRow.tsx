import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';
import { usePushSubscription } from '../../hooks/usePushSubscription.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export function WebPushRow() {
    const toast = useToast();
    const { state, busy, error, enable, disable, sendTest } = usePushSubscription();

    let bodyText: string;
    let primary: React.ReactNode = null;
    let secondary: React.ReactNode = null;

    switch (state) {
        case 'unsupported':
            bodyText = "This browser doesn't support push notifications.";
            break;
        case 'denied':
            bodyText =
                'Browser blocked notifications. Re-enable in site settings to opt back in.';
            break;
        case 'granted-subscribed':
            bodyText = 'Enabled on this device — every published notification will pop up here.';
            primary = (
                <Button
                    variant="outlined"
                    onClick={async () => {
                        await disable();
                        toast.show({ message: 'Web push disabled on this device' });
                    }}
                    disabled={busy}
                    sx={{ textTransform: 'none', fontWeight: 500 }}
                >
                    Disable
                </Button>
            );
            secondary = (
                <Button
                    variant="text"
                    onClick={async () => {
                        const result = await sendTest();
                        toast.show({
                            message: result.ok
                                ? `Test push sent (${result.delivered}/${result.subscriptions} device${result.subscriptions === 1 ? '' : 's'})`
                                : `Test failed: ${result.error ?? 'no devices reached'}`,
                        });
                    }}
                    disabled={busy}
                    sx={{ textTransform: 'none', fontWeight: 500 }}
                >
                    Send test
                </Button>
            );
            break;
        case 'granted-unsubscribed':
        case 'default':
        default:
            bodyText = 'Not enabled on this device yet.';
            primary = (
                <Button
                    variant="contained"
                    startIcon={<NotificationsActiveRounded sx={{ fontSize: 16 }} />}
                    onClick={async () => {
                        await enable();
                    }}
                    disabled={busy}
                    sx={{ textTransform: 'none', fontWeight: 500 }}
                >
                    Enable web push
                </Button>
            );
            break;
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70 }}>
                {bodyText}
            </Typography>
            {(primary || secondary) && (
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    {primary}
                    {secondary}
                </Box>
            )}
            {error && (
                <Alert
                    severity="warning"
                    sx={{
                        mt: 1,
                        fontSize: 12,
                        bgcolor: 'rgba(199,83,47,.06)',
                        border: `1px solid rgba(199,83,47,.18)`,
                        color: ATLAS_PALETTE.slate,
                        '& .MuiAlert-message': { fontSize: 12 },
                    }}
                >
                    {error}
                </Alert>
            )}
        </Box>
    );
}
