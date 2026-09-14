import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import type { IWorkflow } from '@atlas/shared';
import { useIssues } from '../../hooks/useIssues.js';
import { useStartWorkflowRun } from '../../hooks/useWorkflows.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface ReadyItem {
    id: string;
    title: string;
    kind: string;
    queued: boolean;
}

export function RunWorkflowDialog({ workflow, onClose }: { workflow: IWorkflow; onClose: () => void }) {
    const navigate = useNavigate();
    const { data: tree, isLoading } = useIssues({ projectId: workflow.project_id ?? undefined });
    const start = useStartWorkflowRun();
    const [itemId, setItemId] = useState('');

    // Items already queued for this workflow first — they're the ones it
    // would pick up on its own.
    const items = useMemo<ReadyItem[]>(() => {
        if (!tree) return [];
        const rows = [
            ...tree.epics.map((e) => ({ ...e, kind: 'Epic' })),
            ...tree.stories.map((s) => ({ ...s, kind: 'Story' })),
            ...tree.bugs.map((b) => ({ ...b, kind: 'Bug' })),
        ];
        return rows
            .filter((r) => r.status === 'ready')
            .map((r) => ({ id: r.id, title: r.title, kind: r.kind, queued: r.workflow_id === workflow.id }))
            .sort((a, b) => Number(b.queued) - Number(a.queued));
    }, [tree, workflow.id]);

    async function handleStart() {
        const { run_id } = await start.mutateAsync({ workflowId: workflow.id, itemId });
        onClose();
        navigate(`/workflows/${workflow.id}/runs/${run_id}`);
    }

    return (
        <Dialog open onClose={start.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 2 }}>Run {workflow.name}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '8px !important' }}>
                <TextField
                    select
                    label="Ready item"
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                    disabled={isLoading}
                    fullWidth
                >
                    {items.map((i) => (
                        <MenuItem key={i.id} value={i.id}>
                            {i.kind} · {i.id} — {i.title}
                            {i.queued ? ' (queued here)' : ''}
                        </MenuItem>
                    ))}
                </TextField>
                {!isLoading && items.length === 0 && (
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        No ready items in this project. Move an item to Ready to run it here.
                    </Typography>
                )}
                {start.error && <Alert severity="error">{start.error.message}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={start.isPending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    disabled={!itemId || start.isPending}
                    onClick={() => void handleStart().catch(() => undefined)}
                    sx={{
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {start.isPending ? 'Starting…' : 'Start run'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
