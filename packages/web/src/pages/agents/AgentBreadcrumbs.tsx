import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    category: string;
    agentName: string;
}

const NOWRAP = {
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
};

export function AgentBreadcrumbs({ category, agentName }: Props) {
    const navigate = useNavigate();
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 3,
                fontSize: 12.5,
                // Single line at all viewport widths. Earlier segments stay
                // full-text; the agent name (last segment) takes whatever's
                // left and truncates with ellipsis when it can't fit. The
                // row itself clips any further overflow so the layout never
                // spills outside the page padding.
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'hidden',
            }}
        >
            <Typography
                onClick={() => navigate('/agents')}
                sx={{
                    ...NOWRAP,
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.brandBlue,
                    cursor: 'pointer',
                    '&:hover': { textDecoration: 'underline' },
                }}
            >
                Agents
            </Typography>
            <Typography sx={{ ...NOWRAP, fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>
                /
            </Typography>
            <Typography sx={{ ...NOWRAP, fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                {category}
            </Typography>
            <Typography sx={{ ...NOWRAP, fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>
                /
            </Typography>
            <Typography
                title={agentName}
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate,
                    flex: '1 1 auto',
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}
            >
                {agentName}
            </Typography>
        </Box>
    );
}
