import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface InfoPanelProps {
    label: string;
    children: ReactNode;
    mb?: number | string | undefined;
    headerRight?: ReactNode | undefined;
}

const HEADER_LABEL_SX = {
    fontSize: 11,
    fontWeight: 600,
    color: ATLAS_PALETTE.slate60,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
};

export function InfoPanel({ label, children, mb, headerRight }: InfoPanelProps) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: '16px 18px',
                mb,
            }}
        >
            {headerRight ? (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1.5,
                        mb: 2,
                    }}
                >
                    <Typography sx={HEADER_LABEL_SX}>{label}</Typography>
                    {headerRight}
                </Box>
            ) : (
                <Typography sx={{ ...HEADER_LABEL_SX, mb: 2 }}>{label}</Typography>
            )}
            {children}
        </Box>
    );
}

interface InfoRowProps {
    label: string;
    children: ReactNode;
    onClick?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
    clickable?: boolean | undefined;
}

export function InfoRow({ label, children, onClick, clickable = false }: InfoRowProps) {
    return (
        <Box
            onClick={onClick}
            sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                justifyContent: { xs: 'flex-start', md: 'space-between' },
                alignItems: { xs: 'flex-start', md: 'center' },
                gap: { xs: 0.5, md: 0 },
                py: 1.5,
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:first-of-type': { borderTop: 0, pt: 0 },
                cursor: clickable ? 'pointer' : 'default',
                transition: 'background 120ms ease',
                '&:hover': clickable
                    ? {
                          background: ATLAS_PALETTE.cloud,
                          borderRadius: '6px',
                          mx: -1,
                          px: 1,
                      }
                    : undefined,
            }}
        >
            <Typography
                sx={{
                    fontSize: 12,
                    color: ATLAS_PALETTE.slate60,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                }}
            >
                {label}
            </Typography>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    textAlign: { xs: 'left', md: 'right' },
                    // Allow any single-line ellipsis pattern in the value
                    // (Role, Color hex, glyph name, etc.) to actually fire.
                    // Without minWidth: 0 the flex item grows to fit content
                    // and overflow: hidden/textOverflow: ellipsis can never
                    // trigger on its children.
                    minWidth: 0,
                    maxWidth: '100%',
                }}
            >
                {children}
            </Box>
        </Box>
    );
}
