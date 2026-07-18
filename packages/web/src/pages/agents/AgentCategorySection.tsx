import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    label: string;
    count: number;
    children: ReactNode;
}

export function AgentCategorySection({ label, count, children }: Props) {
    return (
        <Box sx={{ mb: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 3 }}>
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {label}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate40 }}>
                    {count}
                </Typography>
            </Box>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))',
                        md: 'repeat(3, minmax(0, 1fr))',
                        xl: 'repeat(4, minmax(0, 1fr))',
                    },
                    gap: 3,
                }}
            >
                {children}
            </Box>
        </Box>
    );
}
