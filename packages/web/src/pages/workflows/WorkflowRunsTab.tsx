import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { useWorkflowRuns } from '../../hooks/useWorkflows.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatAbsolute, relativeTime } from '../../utils/time.js';
import { WorkflowRunStatusChip } from './WorkflowRunStatusChip.js';
import { durationLabel } from './labels.js';

const HEAD_SX = { fontSize: 11, fontWeight: 600, color: ATLAS_PALETTE.slate60, textTransform: 'uppercase', letterSpacing: '0.05em' } as const;
const MONO_SX = { fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12, color: ATLAS_PALETTE.slate70 } as const;

export function WorkflowRunsTab({ workflowId }: { workflowId: string }) {
    const navigate = useNavigate();
    const { data: runs, isLoading, error } = useWorkflowRuns(workflowId);

    if (error) return <Alert severity="error">Couldn&apos;t load runs: {error.message}</Alert>;
    if (isLoading) return <Skeleton variant="rounded" height={160} />;
    if (!runs || runs.length === 0) {
        return (
            <Box sx={{ p: 6, textAlign: 'center', border: `1.5px dashed ${ATLAS_PALETTE.slate12}`, borderRadius: '12px' }}>
                <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}>
                    No runs yet. Use Run now, or queue ready items for this workflow.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ overflowX: 'auto', border: `1px solid ${ATLAS_PALETTE.slate10}`, borderRadius: '12px', background: ATLAS_PALETTE.white }}>
            <Table size="small" sx={{ minWidth: 640 }}>
                <TableHead>
                    <TableRow>
                        <TableCell sx={HEAD_SX}>Item</TableCell>
                        <TableCell sx={HEAD_SX}>Status</TableCell>
                        <TableCell sx={HEAD_SX}>Started</TableCell>
                        <TableCell sx={HEAD_SX}>Duration</TableCell>
                        <TableCell sx={HEAD_SX}>Pull request</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {runs.map((run) => (
                        <TableRow
                            key={run.id}
                            hover
                            onClick={() => navigate(`/workflows/${workflowId}/runs/${run.id}`)}
                            sx={{ cursor: 'pointer' }}
                        >
                            <TableCell>
                                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 500 }}>
                                    {run.item_title ?? 'Project run'}
                                </Typography>
                                <Typography sx={MONO_SX}>{run.item_id ?? run.id.slice(0, 8)}</Typography>
                            </TableCell>
                            <TableCell>
                                <WorkflowRunStatusChip status={run.status} />
                            </TableCell>
                            <TableCell title={formatAbsolute(run.started_at)} sx={MONO_SX}>
                                {relativeTime(run.started_at)}
                            </TableCell>
                            <TableCell sx={MONO_SX}>{durationLabel(run.started_at, run.finished_at)}</TableCell>
                            <TableCell>
                                {run.pr_url ? (
                                    <Link
                                        href={run.pr_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        sx={{ fontSize: 12.5 }}
                                    >
                                        Open PR
                                    </Link>
                                ) : (
                                    <Typography sx={MONO_SX}>—</Typography>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Box>
    );
}
