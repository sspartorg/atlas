import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import SourceRounded from '@mui/icons-material/SourceRounded';
import type { CloneStatus, IProject, IProjectRepo } from '@atlas/shared';
import { api } from '../../api/api.js';
import {
    useProjectRepos,
    useRemoveProjectRepo,
    useUpdateProjectRepo,
} from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { RowActionMenu } from '../../components/RowActionMenu.js';
import { RecloneProjectModal } from '../projects/RecloneProjectModal.js';
import { AutoFetchScheduleModal } from '../projects/AutoFetchScheduleModal.js';
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
    project: IProject;
    displayId: string;
}

/** ADR 0018 — the project's repos. All equal; every one can be removed. */
export function ProjectReposCard({ project, displayId }: Props) {
    const projectId = project.id;
    const { data: repos, isLoading, error } = useProjectRepos(projectId);
    const remove = useRemoveProjectRepo(projectId);
    const toast = useToast();
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<IProjectRepo | null>(null);
    const [removing, setRemoving] = useState<IProjectRepo | null>(null);
    const [recloning, setRecloning] = useState<IProjectRepo | null>(null);
    const [scheduling, setScheduling] = useState<IProjectRepo | null>(null);

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

    async function openFolder(repo: IProjectRepo) {
        try {
            const res = await api.projects.reveal(projectId, repo.id);
            toast.show({ message: 'Opened in File Explorer', detail: res.path });
        } catch (e) {
            toast.show({
                message: 'Could not open File Explorer',
                detail: e instanceof Error ? e.message : 'Unknown error',
            });
        }
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
                        Task&apos;s branch. Every repo carries its own branch, schedule and setup
                        scripts — the scripts live on the Setup tab.
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

            {repos?.length === 0 && (
                <Box sx={{ py: 5, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        No repos yet
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Add a repo to give this project&apos;s Tasks something to check out.
                    </Typography>
                </Box>
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
                    <RowActionMenu
                        ariaLabel={`Actions for ${repo.name}`}
                        items={[
                            {
                                label: 'Edit',
                                icon: <EditRounded fontSize="small" />,
                                onClick: () => setEditing(repo),
                            },
                            {
                                label: 'Auto-fetch schedule…',
                                icon: <ScheduleRounded fontSize="small" />,
                                onClick: () => setScheduling(repo),
                            },
                            {
                                label: 'Re-clone from remote',
                                icon: <RefreshRounded fontSize="small" />,
                                onClick: () => setRecloning(repo),
                            },
                            {
                                label: 'Open folder',
                                icon: <FolderOpenRounded fontSize="small" />,
                                onClick: () => void openFolder(repo),
                            },
                            {
                                label: 'Remove',
                                icon: <DeleteOutlineRounded fontSize="small" />,
                                onClick: () => setRemoving(repo),
                                danger: true,
                                dividerAbove: true,
                            },
                        ]}
                    />
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
            {recloning && (
                <RecloneProjectModal
                    open
                    project={project}
                    repo={recloning}
                    displayId={displayId}
                    onClose={() => setRecloning(null)}
                />
            )}
            {scheduling && (
                <AutoFetchScheduleModal
                    open
                    project={project}
                    repo={scheduling}
                    onClose={() => setScheduling(null)}
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

    async function save() {
        await update.mutateAsync({ repoId: repo.id, data: { default_branch: branch.trim() } });
        toast.show({ message: `Saved ${repo.name}` });
        onClose();
    }

    return (
        <Dialog open onClose={update.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
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
                    sx={{ mt: 1 }}
                />
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mt: 2 }}>
                    This repo&apos;s setup scripts live on the Setup tab.
                </Typography>
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
