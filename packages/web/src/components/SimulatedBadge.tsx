import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    size?: 'sm' | 'md';
}

export function SimulatedBadge({ size = 'md' }: Props) {
    const isSmall = size === 'sm';
    const tip =
        "This output came from simulated mode. Set ATLAS_AI_ENABLED=true in the repo's root .env (or .env.prod for `pnpm run prod`) and restart the API to use the real CLI.";
    return (
        <Tooltip title={tip} arrow placement="top">
            <Box
                role="img"
                aria-label="Simulated mode"
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: isSmall ? 0.75 : 1.25,
                    py: isSmall ? 0.25 : 0.5,
                    borderRadius: '9999px',
                    bgcolor: 'rgba(243, 182, 90, 0.12)',
                    border: '1px solid rgba(243, 182, 90, 0.4)',
                    color: ATLAS_PALETTE.orange,
                    fontSize: isSmall ? 10 : 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    lineHeight: 1,
                    cursor: 'help',
                    whiteSpace: 'nowrap',
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: isSmall ? 12 : 14 }}
                >
                    science
                </Box>
                <Typography
                    component="span"
                    sx={{ fontSize: isSmall ? 10 : 11, fontWeight: 600 }}
                >
                    Simulated
                </Typography>
            </Box>
        </Tooltip>
    );
}
