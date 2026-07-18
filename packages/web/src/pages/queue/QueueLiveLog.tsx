import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { TYPOGRAPHY } from '../../theme/tokens.js';
import { LiveDot } from '../../components/LiveDot.js';

interface Props {
    lines: string[];
    isLive: boolean;
    accent: string;
}

export function QueueLiveLog({ lines, isLive, accent }: Props) {
    return (
        <Box
            sx={{
                background: '#0F1928',
                color: '#C8D4E8',
                borderRadius: '8px',
                p: 2,
                fontFamily: TYPOGRAPHY.fontFamilyMono,
                fontSize: 11,
                lineHeight: 1.6,
                height: '80vh',
                minHeight: 320,
                overflow: 'auto',
                border: '1px solid #1B2A40',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1.5,
                }}
            >
                <Typography
                    sx={{
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 10.5,
                        color: 'rgba(255,255,255,0.5)',
                    }}
                >
                    {isLive ? 'live · agent_output' : 'final · no new lines'}
                </Typography>
                {isLive ? <LiveDot size={7} hex={accent} label="Live" /> : null}
            </Box>
            {lines.length === 0 ? (
                <Typography
                    sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 11, color: '#6B7B95' }}
                >
                    {isLive ? 'Waiting for output…' : 'No output recorded.'}
                </Typography>
            ) : (
                <Box
                    component="pre"
                    sx={{
                        m: 0,
                        p: 0,
                        whiteSpace: 'pre-wrap',
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 11,
                        lineHeight: 1.6,
                    }}
                >
                    {lines.join('\n')}
                </Box>
            )}
        </Box>
    );
}
