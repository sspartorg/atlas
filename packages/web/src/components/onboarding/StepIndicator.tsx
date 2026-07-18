import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface IStepIndicatorProps {
    current: 1 | 2;
    loading?: boolean;
    complete?: boolean;
}

export function StepIndicator({ current, loading = false, complete = false }: IStepIndicatorProps) {
    if (complete) {
        return (
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: ATLAS_PALETTE.green }}>
                Setup complete
            </Typography>
        );
    }

    const dotColor = (active: boolean) =>
        loading || !active ? ATLAS_PALETTE.slate08 : ATLAS_PALETTE.brandBlue;

    const firstActive = current >= 1;
    const secondActive = current >= 2;
    const barFill = loading ? '0%' : current === 2 ? '100%' : '0%';

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 500, color: ATLAS_PALETTE.slate60 }}>
                Step {current} of 2
            </Typography>
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '9999px',
                    bgcolor: dotColor(firstActive),
                }}
            />
            <Box
                sx={{
                    width: 32,
                    height: 3,
                    borderRadius: '9999px',
                    bgcolor: ATLAS_PALETTE.slate08,
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        width: barFill,
                        bgcolor: ATLAS_PALETTE.brandBlue,
                        transition: 'width 250ms ease',
                    }}
                />
            </Box>
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '9999px',
                    bgcolor: dotColor(secondActive),
                }}
            />
        </Box>
    );
}
