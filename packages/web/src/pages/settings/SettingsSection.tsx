import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    title?: string;
    subtitle?: React.ReactNode;
    rightAdornment?: React.ReactNode;
    children: React.ReactNode;
    sx?: object;
}

export function SettingsSection({ title, subtitle, rightAdornment, children, sx }: Props) {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 5,
                mb: 4,
                ...sx,
            }}
        >
            {(title || rightAdornment) && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 3,
                        mb: subtitle ? 1 : 4,
                    }}
                >
                    {title && (
                        <Typography
                            sx={{
                                fontSize: 20,
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.3,
                                letterSpacing: '-0.005em',
                            }}
                        >
                            {title}
                        </Typography>
                    )}
                    {rightAdornment}
                </Box>
            )}
            {subtitle && (
                <Typography
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 5, lineHeight: 1.5 }}
                >
                    {subtitle}
                </Typography>
            )}
            {children}
        </Box>
    );
}
