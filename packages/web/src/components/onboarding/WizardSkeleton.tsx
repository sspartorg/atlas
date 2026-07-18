import Box from '@mui/material/Box';
import { keyframes } from '@emotion/react';
import { ATLAS_PALETTE, ELEVATION } from '../../theme/tokens.js';
import { StepIndicator } from './StepIndicator.js';

const shimmer = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
`;

interface ISkelProps {
    w: number | string;
    h: number;
    br?: number | string;
}

function Skel({ w, h, br = '6px' }: ISkelProps) {
    return (
        <Box
            sx={{
                width: w,
                height: h,
                bgcolor: ATLAS_PALETTE.slate08,
                borderRadius: br,
                position: 'relative',
                overflow: 'hidden',
                '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    background:
                        'linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent)',
                    animation: `${shimmer} 1400ms linear infinite`,
                },
            }}
        />
    );
}

export function WizardSkeleton() {
    return (
        <Box
            sx={{
                minHeight: '100vh',
                bgcolor: ATLAS_PALETTE.cloud,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
            }}
        >
            {/* Page header */}
            <Box
                sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '24px 48px',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            borderRadius: '10px',
                            background: `linear-gradient(135deg, ${ATLAS_PALETTE.brandBlue}, ${ATLAS_PALETTE.cerulean})`,
                            opacity: 0.6,
                        }}
                    />
                    <Skel w={120} h={16} />
                </Box>
                <StepIndicator current={1} loading />
            </Box>

            {/* Centered card region */}
            <Box
                sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: 6,
                    pb: 6,
                }}
            >
                <Box
                    sx={{
                        width: 560,
                        bgcolor: 'background.paper',
                        borderRadius: '16px',
                        p: 12,
                        boxShadow: ELEVATION.overlay,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                    }}
                >
                    <Skel w="60%" h={28} />
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Skel w="90%" h={16} />
                        <Skel w="70%" h={16} />
                    </Box>
                    <Box
                        sx={{
                            maxWidth: 480,
                            mx: 'auto',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            mt: 4,
                        }}
                    >
                        <Skel w="35%" h={14} />
                        <Skel w="100%" h={44} />
                        <Skel w="50%" h={14} />
                        <Box sx={{ display: 'flex', gap: 3 }}>
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                                <Skel key={i} w={28} h={28} br="9999px" />
                            ))}
                        </Box>
                        <Skel w="75%" h={12} />
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 6 }}>
                            <Skel w={90} h={44} />
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
