import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { IAgent, IIssueTreeResponse } from '@atlas/shared';
import {
    WorkItemTable,
    type WorkItemTableRow,
} from '../../components/index.js';
import {
    flattenIssueTree,
    type IIssueListRow,
    makeShortId,
} from '../../hooks/useIssues.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { relativeTime } from '../../utils/time.js';

interface Props {
    projectId: string;
    treeData: IIssueTreeResponse;
    agentsById: Map<string, IAgent>;
    ownerName: string;
    ownerAccent: string;
    formatRelative: (iso: string) => string;
}

const MONO = '"JetBrains Mono", monospace';

function routeForRow(row: IIssueListRow): string {
    if (row.kind === 'story') return `/issues/stories/${row.id}`;
    if (row.kind === 'bug') return `/issues/bugs/${row.id}`;
    if (row.kind === 'sub_task') return `/issues/sub-tasks/${row.id}`;
    return `/issues/sub-bugs/${row.id}`;
}

// Stories + standalone bugs at the top, sub-tasks/sub-bugs nested under their
// parent story. Used by both the project Issues tab and the global /issues
// page when no override sort is active — keeps the parent/child relationship
// visible.
function buildHierarchicalRows(rows: IIssueListRow[]): Array<IIssueListRow & { _child: boolean }> {
    const topLevel = rows.filter((r) => r.kind === 'story' || r.kind === 'bug');
    topLevel.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));

    const childrenByStory = new Map<string, IIssueListRow[]>();
    for (const r of rows) {
        if ((r.kind === 'sub_task' || r.kind === 'sub_bug') && r.parent_story_id) {
            const arr = childrenByStory.get(r.parent_story_id) ?? [];
            arr.push(r);
            childrenByStory.set(r.parent_story_id, arr);
        }
    }
    for (const arr of childrenByStory.values()) {
        arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    const out: Array<IIssueListRow & { _child: boolean }> = [];
    for (const r of topLevel) {
        out.push({ ...r, _child: false });
        if (r.kind === 'story') {
            for (const k of childrenByStory.get(r.id) ?? []) {
                out.push({ ...k, _child: true });
            }
        }
    }
    return out;
}

export function IssuesTabContent({
    projectId,
    treeData,
    agentsById,
    ownerName,
    ownerAccent,
}: Props) {
    const navigate = useNavigate();
    const rows = useMemo<IIssueListRow[]>(
        () => flattenIssueTree(treeData.tree),
        [treeData]
    );

    const ordered = useMemo(() => buildHierarchicalRows(rows), [rows]);

    const tableRows = useMemo<WorkItemTableRow[]>(
        () =>
            ordered.map((r) => ({
                id: r.id,
                kind: r.kind,
                shortId: makeShortId(r.kind, r.id),
                title: r.title,
                status: r.status,
                assignee_agent_id: r.assignee_agent_id,
                reporter_agent_id: r.reporter_agent_id,
                updated_at: r.updated_at,
                isChild: r._child,
            })),
        [ordered]
    );

    const counts = useMemo(() => {
        const c = { story: 0, sub_task: 0, sub_bug: 0, bug: 0 };
        for (const r of rows) c[r.kind]++;
        return c;
    }, [rows]);
    const subItemCount = counts.sub_task + counts.sub_bug;

    function openRow(tableRow: WorkItemTableRow) {
        const source = rows.find((r) => r.id === tableRow.id);
        navigate(source ? routeForRow(source) : routeForRow(tableRow as unknown as IIssueListRow));
    }

    return (
        <Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 3,
                    mb: 3,
                }}
            >
                <Box>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {rows.length}
                        </Box>{' '}
                        {rows.length === 1 ? 'issue' : 'issues'} in this project
                    </Typography>
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                    >
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {counts.story}
                        </Box>{' '}
                        stories ·{' '}
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {subItemCount}
                        </Box>{' '}
                        sub-items ·{' '}
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {counts.bug}
                        </Box>{' '}
                        bugs
                    </Typography>
                </Box>
                <Box
                    component={RouterLink}
                    to={`/issues?project=${projectId}`}
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
                        Open in Issues
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
            <WorkItemTable
                rows={tableRows}
                agentsById={agentsById}
                ownerName={ownerName}
                ownerAccent={ownerAccent}
                onRowClick={openRow}
                formatRelative={relativeTime}
                emptyMessage="No stories or bugs in this project yet."
                showLiveDot
            />
        </Box>
    );
}
