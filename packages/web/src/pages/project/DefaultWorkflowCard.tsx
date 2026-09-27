import { useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { IProject } from '@atlas/shared';
import { useUpdateProject } from '../../hooks/useProjects.js';
import { useWorkflows } from '../../hooks/useWorkflows.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    project: IProject;
}

/**
 * Migration 022 — the workflow /tasks/new preselects for this project, so
 * submitting a Task starts it. Saved on change: a single select has no draft
 * worth guarding behind a Save button.
 *
 * Only the create form reads it. Jira sources keep their own workflow, and a
 * source without one still leaves its Tasks as drafts (ADR 0016) — the helper
 * text says so, because "default" otherwise reads as "applies everywhere".
 */
export function DefaultWorkflowCard({ project }: Props) {
    const { data: workflows = [] } = useWorkflows();
    const update = useUpdateProject();
    const toast = useToast();
    // Inline rather than a toast: the refusal belongs next to the control.
    const [error, setError] = useState<string | null>(null);

    // Same filter as the Jira source dialog and the API's own check.
    const options = workflows.filter(
        (w) => w.input_kind === 'item' && (!w.project_id || w.project_id === project.id)
    );
    // A default the list no longer offers (still loading, or deleted and not
    // yet refetched) shows as None rather than an out-of-range MUI value.
    const value = options.find((w) => w.id === project.default_workflow_id)?.id ?? '';

    async function change(next: string) {
        setError(null);
        try {
            await update.mutateAsync({ id: project.id, data: { default_workflow_id: next || null } });
            toast.show({ message: 'Default workflow saved' });
        } catch (e) {
            // api.ts always throws an Error carrying the API's message.
            setError((e as Error).message);
        }
    }

    return (
        <Box sx={{ mb: 5 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 0.5 }}>
                Default workflow
            </Typography>
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 2, lineHeight: 1.5 }}>
                New Tasks for this project start on this workflow when you submit them. You can
                still pick another, or none, on the form. Jira imports use their source&apos;s
                workflow instead.
            </Typography>
            <TextField
                select
                label="Default workflow"
                value={value}
                onChange={(e) => void change(e.target.value)}
                disabled={update.isPending}
                error={error !== null}
                helperText={error}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 280 }}
            >
                <MenuItem value="">None — Tasks wait until you pick one</MenuItem>
                {options.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                        {w.name}
                    </MenuItem>
                ))}
            </TextField>
        </Box>
    );
}
