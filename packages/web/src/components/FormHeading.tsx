import { type ReactNode } from 'react';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// Shared section-header for modals and forms. Pure type primitive — does not
// own spacing; the caller's layout controls margin. Replaces the
// `<Typography sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate }}>`
// snippet repeated across ~10 sites.
export function FormHeading({ children }: { children: ReactNode }) {
    return (
        <Typography
            sx={{
                fontSize: 16,
                fontWeight: 600,
                color: ATLAS_PALETTE.slate,
            }}
        >
            {children}
        </Typography>
    );
}
