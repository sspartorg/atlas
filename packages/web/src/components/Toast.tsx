import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

function iconForMessage(message: string) {
    if (/copied/i.test(message))
        return <LinkRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.success }} />;
    return <FolderOpenRounded sx={{ fontSize: 16, color: ATLAS_PALETTE.success }} />;
}

export function Toast() {
    const { toasts, dismiss } = useToast();

    if (toasts.length === 0) return null;

    return (
        <Box
            sx={{
                position: 'fixed',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: (t) => t.zIndex.snackbar,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                pointerEvents: 'none',
            }}
        >
            {toasts.map((t) => (
                <Box
                    key={t.id}
                    sx={{
                        pointerEvents: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        minWidth: 360,
                        maxWidth: 560,
                        px: 3,
                        py: 2,
                        bgcolor: ATLAS_PALETTE.surfaceRaised,
                        color: ATLAS_PALETTE.slate,
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '999px',
                        boxShadow: 'var(--atlas-elevation-overlay)',
                    }}
                >
                    {iconForMessage(t.message)}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                            {t.message}
                        </Typography>
                        {t.detail && (
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {t.detail}
                            </Typography>
                        )}
                    </Box>
                    {t.action && (
                        <Box
                            component="button"
                            onClick={() => {
                                t.action!.onClick();
                                dismiss(t.id);
                            }}
                            sx={{
                                background: 'none',
                                border: 'none',
                                color: ATLAS_PALETTE.brandBlue,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                px: 1,
                                '&:hover': { color: ATLAS_PALETTE.slate60 },
                            }}
                        >
                            {t.action.label}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
    );
}
