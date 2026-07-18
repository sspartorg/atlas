import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { AtlasLogo } from './AtlasLogo.js';

// Loading-fallback rule: show the Atlas logo with a spinner. No
// extra wordmark text here — the Atlas mark is the only branding.
export function BrandedFallback() {
    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                width: '100%',
                height: '100%',
                minHeight: 240,
                color: ATLAS_PALETTE.slate60,
            }}
        >
            <AtlasLogo size={56} sx={{ opacity: 0.92 }} />
            <CircularProgress size={20} thickness={3} sx={{ color: ATLAS_PALETTE.slate60 }} />
        </Box>
    );
}
