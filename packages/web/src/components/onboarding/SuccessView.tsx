import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface ISuccessViewProps {
    durationMs?: number;
}

export function SuccessView({ durationMs = 5000 }: ISuccessViewProps) {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const raf = requestAnimationFrame(() => setProgress(100));
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, py: 8 }}>
            <Box
                sx={{
                    width: 96,
                    height: 96,
                    borderRadius: '9999px',
                    bgcolor: 'rgba(49,171,70,.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CheckCircle sx={{ fontSize: 64, color: ATLAS_PALETTE.green }} />
            </Box>
            <Typography
                variant="h2"
                sx={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate,
                    letterSpacing: '-0.01em',
                    m: 0,
                }}
            >
                You're all set.
            </Typography>
            <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}>
                Loading your dashboard…
            </Typography>
            <Box
                sx={{
                    width: 160,
                    height: 3,
                    bgcolor: ATLAS_PALETTE.slate08,
                    borderRadius: '9999px',
                    overflow: 'hidden',
                    mt: 2,
                }}
            >
                <Box
                    sx={{
                        width: `${progress}%`,
                        height: '100%',
                        bgcolor: ATLAS_PALETTE.green,
                        borderRadius: '9999px',
                        transition: `width ${durationMs}ms linear`,
                    }}
                />
            </Box>
        </Box>
    );
}
