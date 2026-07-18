import Box from '@mui/material/Box';
import Fab from '@mui/material/Fab';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, MOBILE_SHELL, ELEVATION } from '../../theme/tokens.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';

interface Props {
    onClick: () => void;
    label: string;
    icon?: string;
}

export function PageFab({ onClick, label, icon = 'add' }: Props) {
    const isMobile = useIsMobile();
    if (!isMobile) return null;
    return (
        <Box
            sx={{
                position: 'fixed',
                right: 16,
                bottom: `calc(${MOBILE_SHELL.fabBottomOffset}px + env(safe-area-inset-bottom))`,
                zIndex: (t) => t.zIndex.appBar - 1,
            }}
        >
            <Fab
                onClick={onClick}
                variant="extended"
                aria-label={label}
                sx={{
                    background: ATLAS_PALETTE.green,
                    // `green` is the Mercury accent — near-black in light, near-white
                    // in dark. The foreground must flip with it, so use the `onAccent`
                    // slot (white in light, dark-slate in dark) instead of hardcoding
                    // white, which renders invisible white-on-white in dark mode.
                    color: ATLAS_PALETTE.onAccent,
                    boxShadow: ELEVATION.high,
                    textTransform: 'none',
                    fontWeight: 600,
                    height: 48,
                    px: 4,
                    gap: 2,
                    '&:hover': { background: ATLAS_PALETTE.greenDark },
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 22 }}
                >
                    {icon}
                </Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{label}</Typography>
            </Fab>
        </Box>
    );
}
