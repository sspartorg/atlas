import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import type { IWorkflowImportResult } from '@atlas/shared';
import { useProjects } from '../../hooks/useProjects.js';
import { useImportWorkflow } from '../../hooks/useWorkflows.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export function importDetail(r: IWorkflowImportResult): string {
    return [
        r.installed_agents.length > 0 ? `Installed ${r.installed_agents.join(', ')}` : '',
        // An import can now bring a stale agent up to date, so say so —
        // otherwise the Owner's agents changed underneath them silently.
        r.agents.upgraded.length > 0 ? `Upgraded ${r.agents.upgraded.join(', ')}` : '',
        // The important one. These are behind the catalog but carry Owner
        // edits, so the import deliberately left them alone; naming them is
        // what keeps "we didn't touch your work" from looking like "we forgot".
        r.agents.skipped_edited.length > 0
            ? `Kept your edits to ${r.agents.skipped_edited.join(', ')} — upgrade offered in the Marketplace`
            : '',
        r.reused_agents.length > 0 ? `Reused ${r.reused_agents.join(', ')}` : '',
        // Import no longer re-activates an agent the Owner paused, so say which
        // ones will hold the run up. Without this the workflow imports clean
        // and then parks on its first step with nothing pointing at why.
        r.agents.paused.length > 0
            ? `${r.agents.paused.join(', ')} ${r.agents.paused.length === 1 ? 'is' : 'are'} paused — runs will wait there until you enable ${r.agents.paused.length === 1 ? 'it' : 'them'}`
            : '',
        r.sub_workflows.length > 0
            ? `Sub-workflows ${r.sub_workflows.map((w) => w.name).join(', ')}`
            : '',
    ]
        .filter((part) => part !== '')
        .join(' · ');
}

export function ImportWorkflowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const navigate = useNavigate();
    const toast = useToast();
    const { data: projects = [] } = useProjects();
    const importWorkflow = useImportWorkflow();
    const fileRef = useRef<HTMLInputElement>(null);
    const [projectId, setProjectId] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const pending = importWorkflow.isPending;

    async function handleImport() {
        if (!file) return;
        const result = await importWorkflow.mutateAsync({ file, projectId });
        const detail = importDetail(result);
        toast.show({ message: `Imported ${result.workflow.name}`, ...(detail ? { detail } : {}) });
        onClose();
        navigate(`/workflows/${result.workflow.id}`);
    }

    return (
        <Dialog open={open} onClose={pending ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 2 }}>Import workflow</DialogTitle>
            <DialogContent
                sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: '8px !important' }}
            >
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70 }}>
                    Upload a workflow bundle exported from Atlas. Its sub-workflows are created with
                    it, and any agent it uses that you don&apos;t have is installed from the bundle.
                    Agents you already have are used as they are.
                </Typography>
                <TextField
                    select
                    label="Project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    fullWidth
                >
                    {projects.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.name}
                        </MenuItem>
                    ))}
                </TextField>
                <Box
                    role="button"
                    tabIndex={0}
                    aria-label="Choose a .zip file"
                    onClick={() => fileRef.current?.click()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
                    }}
                    sx={{
                        border: `2px dashed ${ATLAS_PALETTE.slate10}`,
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        cursor: 'pointer',
                        '&:hover': { borderColor: ATLAS_PALETTE.slate60 },
                    }}
                >
                    <FileUploadRounded sx={{ fontSize: 36, color: ATLAS_PALETTE.slate60, mb: 1 }} />
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70 }}>
                        {file ? file.name : 'Click to choose a .zip file'}
                    </Typography>
                </Box>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".zip,application/zip"
                    hidden
                    data-testid="workflow-zip-input"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {importWorkflow.error && (
                    <Alert severity="error">{importWorkflow.error.message}</Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={pending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => void handleImport().catch(() => undefined)}
                    disabled={!projectId || !file || pending}
                    sx={{
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {pending ? 'Importing…' : 'Import'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
