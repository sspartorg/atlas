import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import type { IEpicListItem, IProject, IAgent } from '@atlas/shared';
import { EpicTable } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    projectId: string;
    epics: IEpicListItem[];
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
}

const MONO = '"JetBrains Mono", monospace';

export function EpicsTabContent({
    projectId,
    epics,
    projects,
    agents,
    ownerName,
    ownerAccent,
}: Props) {
    return (
        <Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 3,
                }}
            >
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    Showing{' '}
                    <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
                        {epics.length}
                    </Box>{' '}
                    {epics.length === 1 ? 'epic' : 'epics'} in this project
                </Typography>
                <Box
                    component={RouterLink}
                    to={`/epics?project=${projectId}`}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.brandBlue,
                        textDecoration: 'none',
                        '&:hover .icon-link-text': { textDecoration: 'underline' },
                    }}
                >
                    <Box component="span" className="icon-link-text">
                        Open in Epics
                    </Box>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 14 }}
                    >
                        open_in_new
                    </Box>
                </Box>
            </Box>
            <EpicTable
                rows={epics}
                projects={projects}
                agents={agents}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
            />
        </Box>
    );
}
