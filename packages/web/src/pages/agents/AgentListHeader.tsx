import Button from '@mui/material/Button';
import AddRounded from '@mui/icons-material/AddRounded';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import MonitorHeartRounded from '@mui/icons-material/MonitorHeartRounded';
import { Link as RouterLink } from 'react-router-dom';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { PageHeader } from '../../components/PageHeader.js';

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
        <PageHeader
            icon="smart_toy"
            title="Agents"
            subtitle={<>{subtitle}</>}
            actions={
                <>
                    <Button
                        variant="outlined"
                        component={RouterLink}
                        to="/agents/performance"
                        startIcon={<MonitorHeartRounded sx={{ fontSize: 18 }} />}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 13.5,
                            px: 3,
                            py: 1.25,
                        }}
                    >
                        Fleet performance
                    </Button>
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
                </>
            }
        />
    );
}
