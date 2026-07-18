import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';

interface IKpiTileProps {
    label: string;
    dotColor: string;
    value: React.ReactNode;
    caption: React.ReactNode;
    /** Optional plain-text version of `caption` for the title tooltip when
     *  the rendered caption is JSX (so the browser tooltip stays readable). */
    captionTitle?: string;
}

// Shared KPI tile used by the dashboard KPI strip and the project Overview
// tab. Label and caption are nowrap+ellipsis so the tile keeps a single-line
// silhouette regardless of column width.
export function KpiTile({ label, dotColor, value, caption, captionTitle }: IKpiTileProps) {
    return (
        <Paper
            elevation={0}
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                borderTop: `3px solid ${dotColor}`,
                p: { xs: 2.5, sm: 3.5, md: 5 },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <Box
                    sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '9999px',
                        bgcolor: dotColor,
                        flexShrink: 0,
                    }}
                />
                <Typography
                    sx={{
                        fontSize: '0.8125rem',
                        color: ATLAS_PALETTE.slate60,
                        whiteSpace: { xs: 'normal', md: 'nowrap' },
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: { xs: 2, md: 1 },
                        WebkitBoxOrient: 'vertical',
                        lineHeight: 1.25,
                    }}
                    title={label}
                >
                    {label}
                </Typography>
            </Box>
            <Typography
                sx={{
                    fontFamily: '"Inter", system-ui, sans-serif',
                    fontSize: { xs: 26, md: 32 },
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    lineHeight: 1.1,
                    mt: { xs: 1.5, md: 2 },
                    textAlign: 'center',
                }}
            >
                {value}
            </Typography>
            <Typography
                sx={{
                    fontSize: '0.75rem',
                    color: ATLAS_PALETTE.slate60,
                    mt: { xs: 1.5, md: 3 },
                    whiteSpace: { xs: 'normal', md: 'nowrap' },
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'center',
                }}
                {...(captionTitle ? { title: captionTitle } : {})}
            >
                {caption}
            </Typography>
        </Paper>
    );
}
