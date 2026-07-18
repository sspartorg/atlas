import { Suspense, lazy } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IProject } from '@atlas/shared';

const ProjectGuardrailsBody = lazy(() =>
    import('../ProjectGuardrails.js').then((m) => ({ default: m.ProjectGuardrailsBody })),
);

interface Props {
    project: IProject;
}

export function GuardrailsTab({ project }: Props) {
    return (
        <Suspense
            fallback={
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '12px' }} />
                    <Skeleton variant="rectangular" height={300} sx={{ borderRadius: '12px' }} />
                </Box>
            }
        >
            <ProjectGuardrailsBody projectId={project.id} projectName={project.name} />
        </Suspense>
    );
}
