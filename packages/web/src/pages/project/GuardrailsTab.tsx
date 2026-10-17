import { Suspense, lazy } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IProject } from '@atlas/shared';
import { useProjectGuardrailScripts } from '../../hooks/useProjectGuardrails.js';

const ProjectGuardrailsBody = lazy(() =>
    import('../ProjectGuardrails.js').then((m) => ({ default: m.ProjectGuardrailsBody }))
);

interface Props {
    project: IProject;
}

export function GuardrailsTab({ project }: Props) {
    // Start the scripts read alongside the body's chunk download instead of
    // after it (the rules are already fetched by ProjectDetail); the body
    // reads both from the same cache.
    useProjectGuardrailScripts(project.id);
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
