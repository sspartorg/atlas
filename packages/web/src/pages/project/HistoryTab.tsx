import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { HistoryTabContent } from './HistoryTabContent.js';

function HistoryTabSkeleton() {
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 5,
            }}
        >
            <Box sx={{ display: 'flex', gap: 1.5, mb: 4 }}>
                <Skeleton variant="rectangular" width={120} height={28} sx={{ borderRadius: '6px' }} />
                <Skeleton variant="rectangular" width={100} height={28} sx={{ borderRadius: '6px' }} />
                <Skeleton variant="rectangular" width={100} height={28} sx={{ borderRadius: '6px' }} />
            </Box>
            <Skeleton variant="rectangular" height={200} sx={{ borderRadius: '10px' }} />
        </Box>
    );
}

export function HistoryTab({ projectId }: { projectId: string }) {
    const ready = useDeferredMount();
    if (!ready) return <HistoryTabSkeleton />;
    return <HistoryTabContent projectId={projectId} />;
}
