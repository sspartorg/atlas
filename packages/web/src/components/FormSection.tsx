import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface FormSectionProps {
    label: string;
    children: ReactNode;
    mb?: number | string | undefined;
}

export function FormSection({ label, children, mb = 3 }: FormSectionProps) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 3,
                mb,
            }}
        >
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate60,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    mb: 2,
                }}
            >
                {label}
            </Typography>
            {children}
        </Box>
    );
}

interface FormRowProps {
    label: string;
    children: ReactNode;
}

export function FormRow({ label, children }: FormRowProps) {
    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '120px 1fr' },
                alignItems: { xs: 'flex-start', md: 'center' },
                gap: { xs: 0.5, md: 2 },
                py: 1.5,
            }}
        >
            <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, fontWeight: 500 }}>
                {label}
            </Typography>
            <Box>{children}</Box>
        </Box>
    );
}
