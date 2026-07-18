import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent, IIssueTreeResponse } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { IssuesTabContent } from './IssuesTabContent.js';

interface Props {
    projectId: string;
    treeData: IIssueTreeResponse | undefined;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    formatRelative: (iso: string) => string;
}

function IssuesTabSkeleton() {
    return (
        <Box>
            {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton
                    key={i}
                    variant="rectangular"
                    height={48}
                    sx={{ borderRadius: '8px', mb: 1 }}
                />
            ))}
        </Box>
    );
}

export function IssuesTab({ treeData, ...rest }: Props) {
    const ready = useDeferredMount();
    if (!ready || treeData === undefined) return <IssuesTabSkeleton />;
    return <IssuesTabContent treeData={treeData} {...rest} />;
}
