import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface HeroActionCardProps {
    icon: ReactNode;
    title: string;
    description: ReactNode;
    cta: { label: string; icon?: ReactNode; onClick: () => void };
}

// Shared "icon + title + description + button" inline card used as a
// HeroEmptyState `primaryAction`. Consolidates the identical wrapper Box and
// Typography pair that Dashboard/Projects empty states each re-implemented.
export function HeroActionCard({ icon, title, description, cta }: HeroActionCardProps) {
    return (
        <Box
            sx={{
                p: 5,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                textAlign: 'left',
                bgcolor: ATLAS_PALETTE.white,
            }}
        >
            <Box
                sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    bgcolor: ATLAS_PALETTE.cloud,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        mb: 0.5,
                    }}
                >
                    {title}
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    {description}
                </Typography>
            </Box>
            <Button
                variant="contained"
                color="success"
                startIcon={cta.icon}
                onClick={cta.onClick}
                sx={{ textTransform: 'none', fontWeight: 600 }}
            >
                {cta.label}
            </Button>
        </Box>
    );
}
