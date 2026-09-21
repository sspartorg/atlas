import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import type { ITaskListItem, IProject, IAgent } from '@atlas/shared';
import { TaskTable } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    projectId: string;
    tasks: ITaskListItem[];
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
}

const MONO = '"JetBrains Mono", monospace';

export function TasksTabContent({
    projectId,
    tasks,
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
                        {tasks.length}
                    </Box>{' '}
                    {tasks.length === 1 ? 'task' : 'tasks'} in this project
                </Typography>
                <Box
                    component={RouterLink}
                    // The Tasks page filters by project name, not id.
                    to={`/tasks?project=${encodeURIComponent(projects.find((p) => p.id === projectId)?.name ?? projectId)}`}
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
                        Open in Tasks
                    </Box>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 14 }}
                    >
                        open_in_new
                    </Box>
                </Box>
            </Box>
            <TaskTable
                rows={tasks}
                projects={projects}
                agents={agents}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
            />
        </Box>
    );
}
