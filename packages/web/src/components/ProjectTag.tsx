import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    projectId?: string;
    name: string;
    size?: 'sm' | 'md';
    clickable?: boolean;
}

export function ProjectTag({ projectId, name, size = 'sm', clickable = false }: Props) {
    const navigate = useNavigate();
    const handleClick =
        clickable && projectId
            ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  navigate(`/projects/${projectId}`);
              }
            : undefined;

    const fontSize = size === 'sm' ? 11 : 12;
    const iconSize = size === 'sm' ? 12 : 14;

    return (
        <Box
            onClick={handleClick}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                height: size === 'sm' ? 20 : 22,
                px: '8px',
                borderRadius: '6px',
                background: 'rgba(46,46,46,.05)',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                cursor: handleClick ? 'pointer' : 'default',
                transition: 'all 150ms ease',
                '&:hover': handleClick
                    ? { background: 'rgba(46,46,46,.08)', borderColor: ATLAS_PALETTE.slate30 }
                    : undefined,
                flexShrink: 0,
            }}
        >
            <Box
                component="span"
                className="material-symbols-rounded"
                sx={{ fontSize: iconSize, color: ATLAS_PALETTE.slate60 }}
            >
                folder
            </Box>
            <Typography
                sx={{
                    fontSize,
                    fontWeight: 500,
                    color: ATLAS_PALETTE.slate60,
                    fontFamily: '"JetBrains Mono", monospace',
                    lineHeight: 1,
                }}
            >
                {name}
            </Typography>
        </Box>
    );
}
