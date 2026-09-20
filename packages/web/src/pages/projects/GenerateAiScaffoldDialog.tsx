import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useNavigate } from 'react-router-dom';
import type { IProject } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';

// Theme 09b — confirms the AI-Readiness Agent trigger. The Owner
// is already on the Project Detail page so we don't re-state the
// project; the dialog summarizes WHAT will happen (branch + files
// + push + PR) and that nothing on `main` is touched. On confirm,
// starts the AI Readiness workflow and opens its run view so the
// Owner watches the work stream.
//
// ADR 0018 — the scaffold reads one checkout, and a project has 0..N equal
// repos, so the dialog names the repo it will analyse and lets the Owner pick
// when more than one is ready.

interface Props {
    project: IProject;
    open: boolean;
    onClose: () => void;
}

export function GenerateAiScaffoldDialog({ project, open, onClose }: Props) {
    const navigate = useNavigate();
    const toast = useToast();
    const [pending, setPending] = useState(false);
    const { data: repos = [] } = useProjectRepos(project.id);

    const readyRepos = useMemo(
        () => repos.filter((r) => r.clone_status === 'ready'),
        [repos],
    );
    const [repoId, setRepoId] = useState('');
    // Default to the first ready repo as soon as the list lands, and drop a
    // selection that a removed repo left behind.
    useEffect(() => {
        if (!readyRepos.some((r) => r.id === repoId)) setRepoId(readyRepos[0]?.id ?? '');
    }, [readyRepos, repoId]);

    const selected = readyRepos.find((r) => r.id === repoId) ?? null;

    async function handleGenerate(): Promise<void> {
        setPending(true);
        try {
            const { run_id, workflow_id } = await api.projects.generateAiScaffold(
                project.id,
                selected?.id,
            );
            onClose();
            navigate(`/workflows/${workflow_id}/runs/${run_id}`);
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
                {readyRepos.length > 1 && (
                    <FormControl fullWidth size="small" sx={{ mt: 1, mb: 3 }}>
                        <InputLabel id="ai-scaffold-repo">Repo</InputLabel>
                        <Select
                            labelId="ai-scaffold-repo"
                            label="Repo"
                            value={repoId}
                            onChange={(e) => setRepoId(e.target.value)}
                        >
                            {readyRepos.map((repo) => (
                                <MenuItem key={repo.id} value={repo.id}>
                                    {repo.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}
                <DialogContentText sx={{ mb: 2 }}>
                    {selected ? (
                        <>
                            Atlas will analyze <code>{selected.name}</code> at{' '}
                            <code>{selected.git_path}</code>, detect its stack, and generate{' '}
                            <code>AGENTS.md</code> + <code>CLAUDE.md</code> +{' '}
                            <code>.github/copilot-instructions.md</code> + <code>.agents/</code>{' '}
                            skeleton on a new branch <code>atlas/ai-readiness</code>, push it, and
                            open a PR for your review.
                        </>
                    ) : (
                        <>This project has no repo ready to analyze.</>
                    )}
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
                    disabled={pending || !selected}
                >
                    {pending ? 'Starting…' : 'Generate'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
