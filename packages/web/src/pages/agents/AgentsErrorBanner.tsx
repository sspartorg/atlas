import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    onRetry: () => void;
}

export function AgentsErrorBanner({ onRetry }: Props) {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                px: 3,
                py: 2,
                borderRadius: '10px',
                border: `1px solid color-mix(in srgb, ${ATLAS_PALETTE.warning} 25%, transparent)`,
                background: `color-mix(in srgb, ${ATLAS_PALETTE.warning} 8%, ${ATLAS_PALETTE.white})`,
                mb: 4,
            }}
        >
            <Box
                component="span"
                className="material-symbols-rounded"
                sx={{ fontSize: 20, color: ATLAS_PALETTE.warning, mt: '2px' }}
            >
                warning
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    sx={{ fontSize: 13.5, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 0.25 }}
                >
                    Couldn&apos;t load agent statuses
                </Typography>
                <Typography
                    sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate70, lineHeight: 1.55 }}
                >
                    The runtime queue is unreachable. Cards below show config from disk, but live
                    status, queue depth, and last-run times are stale.
                </Typography>
            </Box>
            <Button
                variant="outlined"
                onClick={onRetry}
                startIcon={
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 16 }}
                    >
                        refresh
                    </Box>
                }
                sx={{
                    textTransform: 'none',
                    fontWeight: 500,
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                    borderColor: ATLAS_PALETTE.slate12,
                    bgcolor: ATLAS_PALETTE.white,
                    '&:hover': {
                        borderColor: ATLAS_PALETTE.slate30,
                        bgcolor: ATLAS_PALETTE.slate08,
                    },
                }}
            >
                Retry
            </Button>
        </Box>
    );
}
