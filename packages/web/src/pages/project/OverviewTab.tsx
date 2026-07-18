import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { ProjectCounts } from '../../api/types.js';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { OverviewTabContent } from './OverviewTabContent.js';

interface Props {
    counts: ProjectCounts | undefined;
    projectId: string;
    onJumpToHistory: () => void;
}

function OverviewTabSkeleton() {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                        xs: 'minmax(0, 1fr) minmax(0, 1fr)',
                        sm: 'minmax(0, 1fr) minmax(0, 1fr)',
                        lg: 'repeat(3, minmax(0, 1fr))',
                    },
                    gap: 3,
                }}
            >
                {[1, 2, 3].map((i) => (
                    <Skeleton
                        key={i}
                        variant="rectangular"
                        height={104}
                        sx={{ borderRadius: '10px' }}
                    />
                ))}
            </Box>
            <Skeleton variant="rectangular" height={220} sx={{ borderRadius: '12px' }} />
        </Box>
    );
}

export function OverviewTab({ counts, projectId, onJumpToHistory }: Props) {
    const ready = useDeferredMount();
    if (!ready || counts === undefined) return <OverviewTabSkeleton />;
    return (
        <OverviewTabContent
            counts={counts}
            projectId={projectId}
            onJumpToHistory={onJumpToHistory}
        />
    );
}
