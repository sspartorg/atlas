import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface HeroEmptyStateProps {
    icon: ReactNode;
    title: string;
    description?: ReactNode | undefined;
    primaryAction?: ReactNode | undefined;
    supplemental?: ReactNode | undefined;
}

export function HeroEmptyState({
    icon,
    title,
    description,
    primaryAction,
    supplemental,
}: HeroEmptyStateProps) {
    return (
        <Box
            sx={{
                maxWidth: 720,
                mx: 'auto',
                mt: 16,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 4,
                px: 4,
            }}
        >
            <Box
                sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.cloud,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {icon}
            </Box>

            <Typography
                variant="h2"
                sx={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    letterSpacing: '-0.01em',
                }}
            >
                {title}
            </Typography>

            {description && (
                <Typography
                    sx={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: ATLAS_PALETTE.slate60,
                        maxWidth: 540,
                    }}
                >
                    {description}
                </Typography>
            )}

            {primaryAction && <Box sx={{ width: '100%' }}>{primaryAction}</Box>}

            {supplemental && <Box sx={{ width: '100%' }}>{supplemental}</Box>}
        </Box>
    );
}
