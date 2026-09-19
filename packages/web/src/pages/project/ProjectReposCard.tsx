import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import SourceRounded from '@mui/icons-material/SourceRounded';
import type { CloneStatus, IProjectRepo } from '@atlas/shared';
import {
    useProjectRepos,
    useRemoveProjectRepo,
    useUpdateProjectRepo,
} from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { AddRepoDialog } from './AddRepoDialog.js';

const MONO = '"JetBrains Mono", monospace';

const STATUS_COLOR: Record<CloneStatus, string> = {
    ready: ATLAS_PALETTE.green,
    cloning: ATLAS_PALETTE.brandBlue,
    pending: ATLAS_PALETTE.slate60,
    error: ATLAS_PALETTE.error,
};

function repoLabel(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\.git\/?$/, '');
}

interface Props {
    projectId: string;
}

/** ADR 0017 — the project's repos: the primary (the project's own) + extras. */
export function ProjectReposCard({ projectId }: Props) {
    const { data: repos, isLoading, error } = useProjectRepos(projectId);
    const remove = useRemoveProjectRepo(projectId);
    const toast = useToast();
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<IProjectRepo | null>(null);
    const [removing, setRemoving] = useState<IProjectRepo | null>(null);

    async function confirmRemove() {
        if (!removing) return;
        try {
            await remove.mutateAsync(removing.id);
            toast.show({ message: `Removed ${removing.name}` });
        } catch (e) {
            toast.show({ message: e instanceof Error ? e.message : 'Could not remove the repo' });
        }
        setRemoving(null);
    }

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        <SourceRounded sx={{ fontSize: 20, color: ATLAS_PALETTE.brandBlue }} />
                        Repositories
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        A Task works on the repos it picks; each gets its own checkout on the
                        Task&apos;s branch. The primary is the project&apos;s own repo — edit its
                        setup scripts on the Setup tab.
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddRounded />}
                    onClick={() => setAdding(true)}
                    sx={{ textTransform: 'none', flexShrink: 0 }}
                >
                    Add repo
                </Button>
            </Box>

            {isLoading && (
                <Skeleton variant="rectangular" height={64} sx={{ borderRadius: '8px' }} />
            )}
            {error && (
                <Alert severity="error">
                    {error instanceof Error ? error.message : 'Could not load the repos'}
                </Alert>
            )}

            {repos?.map((repo) => (
                <Box
                    key={repo.id}
                    data-testid={`repo-row-${repo.name}`}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        py: 2,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                        '&:first-of-type': { borderTop: 0 },
                    }}
                >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                        >
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                {repo.name}
                            </Typography>
                            {repo.primary && <Chip label="Primary" size="small" color="primary" />}
                            <Chip
                                label={repo.default_branch}
                                size="small"
                                sx={{ fontFamily: MONO, fontSize: 11 }}
                            />
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: STATUS_COLOR[repo.clone_status],
                                }}
                            >
                                {repo.clone_status}
                            </Typography>
                        </Box>
                        {repo.git_url && (
                            <Box
                                component="a"
                                href={repo.git_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.brandBlue,
                                    textDecoration: 'none',
                                    '&:hover': { textDecoration: 'underline' },
                                }}
                            >
                                {repoLabel(repo.git_url)}
                            </Box>
                        )}
                    </Box>
                    {!repo.primary && (
                        <>
                            <Tooltip title="Edit">
                                <IconButton
                                    size="small"
                                    aria-label={`Edit ${repo.name}`}
                                    onClick={() => setEditing(repo)}
                                >
                                    <EditRounded sx={{ fontSize: 18 }} />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Remove">
                                <IconButton
                                    size="small"
                                    aria-label={`Remove ${repo.name}`}
                                    onClick={() => setRemoving(repo)}
                                >
                                    <DeleteOutlineRounded sx={{ fontSize: 18 }} />
                                </IconButton>
                            </Tooltip>
                        </>
                    )}
                </Box>
            ))}

            {adding && <AddRepoDialog projectId={projectId} onClose={() => setAdding(false)} />}
            {editing && (
                <EditRepoDialog
                    projectId={projectId}
                    repo={editing}
                    onClose={() => setEditing(null)}
                />
            )}
            <ConfirmActionModal
                open={removing !== null}
                title={`Remove ${removing?.name ?? 'repo'}?`}
                body="Atlas stops using this repo and drops it from the project's Tasks. The folder stays on disk."
                confirmLabel="Remove"
                tone="destructive"
                busy={remove.isPending}
                onCancel={() => setRemoving(null)}
                onConfirm={() => void confirmRemove()}
            />
        </Box>
    );
}

function EditRepoDialog({
    projectId,
    repo,
    onClose,
}: {
    projectId: string;
    repo: IProjectRepo;
    onClose: () => void;
}) {
    const update = useUpdateProjectRepo(projectId);
    const toast = useToast();
    const [branch, setBranch] = useState(repo.default_branch);
    const [sh, setSh] = useState(repo.setup_sh_body);
    const [ps1, setPs1] = useState(repo.setup_ps1_body);

    async function save() {
        await update.mutateAsync({
            repoId: repo.id,
            data: { default_branch: branch.trim(), setup_sh_body: sh, setup_ps1_body: ps1 },
        });
        toast.show({ message: `Saved ${repo.name}` });
        onClose();
    }

    const scriptSx = { fontFamily: MONO, fontSize: 12.5, alignItems: 'flex-start' };

    return (
        <Dialog open onClose={update.isPending ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>
                Edit{' '}
                <Box component="span" sx={{ fontFamily: MONO }}>
                    {repo.name}
                </Box>
            </DialogTitle>
            <DialogContent>
                <TextField
                    fullWidth
                    size="small"
                    label="Default branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    sx={{ mt: 1, mb: 3 }}
                />
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                    Setup scripts run in this repo&apos;s checkout before the agent CLI starts — the
                    PowerShell body on Windows, the shell body elsewhere.
                </Typography>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                        gap: 3,
                    }}
                >
                    <TextField
                        fullWidth
                        multiline
                        minRows={10}
                        maxRows={24}
                        label=".sh"
                        value={sh}
                        onChange={(e) => setSh(e.target.value)}
                        InputProps={{ sx: scriptSx }}
                    />
                    <TextField
                        fullWidth
                        multiline
                        minRows={10}
                        maxRows={24}
                        label=".ps1"
                        value={ps1}
                        onChange={(e) => setPs1(e.target.value)}
                        InputProps={{ sx: scriptSx }}
                    />
                </Box>
                {update.isError && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {update.error instanceof Error ? update.error.message : 'Could not save'}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button
                    onClick={onClose}
                    disabled={update.isPending}
                    sx={{ textTransform: 'none' }}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => void save().catch(() => {})}
                    disabled={!branch.trim() || update.isPending}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    {update.isPending ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
