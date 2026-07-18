import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface EmptyStateProps {
    icon: ReactNode;
    title: string;
    description?: ReactNode | undefined;
    actions?: ReactNode | undefined;
    supplemental?: ReactNode | undefined;
    variant?: 'solid' | 'dashed' | undefined;
}

export function EmptyState({
    icon,
    title,
    description,
    actions,
    supplemental,
    variant = 'solid',
}: EmptyStateProps) {
    const border =
        variant === 'dashed'
            ? `1.5px dashed ${ATLAS_PALETTE.slate12}`
            : `1px solid ${ATLAS_PALETTE.slate10}`;
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border,
                borderRadius: '16px',
                px: 6,
                py: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 3,
            }}
        >
            <Box
                sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: ATLAS_PALETTE.slate06,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {icon}
            </Box>
            <Box>
                <Typography
                    sx={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        mb: 1,
                    }}
                >
                    {title}
                </Typography>
                {description && (
                    <Typography
                        sx={{
                            fontSize: 13.5,
                            color: ATLAS_PALETTE.slate60,
                            maxWidth: 480,
                            mx: 'auto',
                            lineHeight: 1.6,
                        }}
                    >
                        {description}
                    </Typography>
                )}
            </Box>
            {actions && (
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {actions}
                </Box>
            )}
            {supplemental && <Box sx={{ width: '100%', maxWidth: 520 }}>{supplemental}</Box>}
        </Box>
    );
}
