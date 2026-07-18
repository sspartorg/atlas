import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import type { IProject } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useToast } from '../../hooks/useToast.js';

// Theme 09b — confirms the AI-Readiness Agent trigger. The Owner
// is already on the Project Detail page so we don't re-state the
// project; the dialog summarizes WHAT will happen (branch + files
// + push + PR) and that nothing on `main` is touched. On confirm,
// dispatches the run and navigates to the run-detail page so the
// Owner watches the work stream.

interface Props {
    project: IProject;
    open: boolean;
    onClose: () => void;
}

export function GenerateAiScaffoldDialog({ project, open, onClose }: Props) {
    const navigate = useNavigate();
    const toast = useToast();
    const [pending, setPending] = useState(false);

    async function handleGenerate(): Promise<void> {
        setPending(true);
        try {
            const { run_id } = await api.projects.generateAiScaffold(project.id);
            onClose();
            navigate(`/agents/agent-ai-readiness/runs/${run_id}`);
        } catch (err) {
            toast.show({
                message: 'Generate AI scaffold failed',
                detail: (err as Error).message,
            });
        } finally {
            setPending(false);
        }
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Generate AI scaffold</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    Atlas will analyze the repo at <code>{project.git_path}</code>,
                    detect its stack, and generate <code>AGENTS.md</code> +{' '}
                    <code>CLAUDE.md</code> + <code>.github/copilot-instructions.md</code>{' '}
                    + <code>.agents/</code> skeleton on a new branch{' '}
                    <code>atlas/ai-readiness</code>, push it, and open a PR for
                    your review.
                </DialogContentText>
                <DialogContentText>
                    Files that already exist on <code>main</code> will be skipped.
                    The agent never overwrites existing files and never force-pushes.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={pending}>
                    Cancel
                </Button>
                <Button
                    onClick={handleGenerate}
                    variant="contained"
                    disabled={pending}
                >
                    {pending ? 'Starting…' : 'Generate'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
