import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    onRefresh: () => void;
    isFetching: boolean;
    tooltipLabel?: string;
    size?: 'small' | 'medium';
}

export function RefreshButton({
    onRefresh,
    isFetching,
    tooltipLabel = 'Refresh page data',
    size = 'small',
}: Props) {
    return (
        <Tooltip title={isFetching ? 'Refreshing…' : tooltipLabel}>
            <span>
                <IconButton
                    size={size}
                    // The Tooltip wraps the <span>, not this button — MUI
                    // forwards `title` to its immediate child only, so the
                    // label would land on the wrapper and leave the button
                    // unnamed once the icon glyph is aria-hidden (G-015).
                    // The span exists because a disabled button fires no
                    // events for the tooltip to listen to.
                    aria-label={tooltipLabel}
                    onClick={onRefresh}
                    disabled={isFetching}
                    sx={{
                        color: ATLAS_PALETTE.slate60,
                        '&:hover': { color: ATLAS_PALETTE.slate, bgcolor: ATLAS_PALETTE.slate08 },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{
                            fontSize: size === 'small' ? 18 : 20,
                            animation: isFetching ? 'refresh-spin 0.9s linear infinite' : 'none',
                            '@keyframes refresh-spin': {
                                from: { transform: 'rotate(0deg)' },
                                to: { transform: 'rotate(360deg)' },
                            },
                        }}
                    >
                        refresh
                    </Box>
                </IconButton>
            </span>
        </Tooltip>
    );
}
