import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AddRounded from '@mui/icons-material/AddRounded';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    installedCount: number;
    categoryCount: number;
    onAdd: () => void;
    onImport?: () => void;
}

export function AgentListHeader({ installedCount, categoryCount, onAdd, onImport }: Props) {
    const subtitle =
        installedCount === 0
            ? '0 installed'
            : `${installedCount} installed · ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}`;
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                mb: 5,
                gap: 4,
                flexWrap: 'wrap',
            }}
        >
            <Box>
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: '2.25rem',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    Agents
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                    {subtitle}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
                {onImport && (
                    <Button
                        variant="outlined"
                        startIcon={<FileUploadRounded sx={{ fontSize: 18 }} />}
                        onClick={onImport}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 13.5,
                            px: 3,
                            py: 1.25,
                            display: { xs: 'none', md: 'inline-flex' },
                        }}
                    >
                        Import zip
                    </Button>
                )}
                <Button
                    variant="contained"
                    startIcon={<AddRounded sx={{ fontSize: 18 }} />}
                    onClick={onAdd}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: 13.5,
                        px: 3,
                        py: 1.25,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        display: { xs: 'none', md: 'inline-flex' },
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    Add Agent
                </Button>
            </Box>
        </Box>
    );
}
