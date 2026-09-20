import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { ConnectError } from '../../api/api.js';
import { useCredentials } from '../../hooks/useCredentials.js';
import { useCloneJob } from '../../hooks/useCloneJob.js';
import { useCloneProjectRepo, useConnectProjectRepo } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FolderPicker } from '../../components/FolderPicker.js';
import { FormHeading } from '../../components/FormHeading.js';
import {
    ConnectErrorDetails,
    CredentialSelect,
    LABEL_SX,
    inputSx,
} from '../projects/RepoFormParts.js';

const MONO = '"JetBrains Mono", monospace';
const REPO_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
// Mirrors RepoNameSchema: the name is the repo's folder in a multi-repo workspace.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

type Mode = 'clone' | 'connect';

interface Props {
    projectId: string;
    onClose: () => void;
}

function slugFromUrl(url: string): string {
    const repo = url.trim().match(REPO_RE)?.[2] ?? '';
    return repo
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/** Mounted only while open, so every open starts from a blank form. */
export function AddRepoDialog({ projectId, onClose }: Props) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const toast = useToast();
    const { data: credentials = [] } = useCredentials();
    const cloneRepo = useCloneProjectRepo(projectId);
    const connectRepo = useConnectProjectRepo(projectId);

    const [mode, setMode] = useState<Mode>('clone');
    const [repoUrl, setRepoUrl] = useState('');
    const [nameChoice, setNameChoice] = useState<string | null>(null);
    const [credentialChoice, setCredentialChoice] = useState<string | null>(null);
    const [defaultBranch, setDefaultBranch] = useState('main');
    const [folder, setFolder] = useState('');
    const [cloneId, setCloneId] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [connectError, setConnectError] = useState<ConnectError | null>(null);
    const job = useCloneJob(cloneId);

    const name = nameChoice ?? slugFromUrl(repoUrl);
    const credentialId = credentialChoice ?? credentials[0]?.id ?? '';
    const cloning = cloneId !== null && job.status === 'cloning';
    const busy = cloning || cloneRepo.isPending || connectRepo.isPending;
    const nameInvalid = name !== '' && !NAME_RE.test(name);
    const canSubmit =
        NAME_RE.test(name) &&
        REPO_RE.test(repoUrl.trim()) &&
        credentialId !== '' &&
        (mode === 'clone' ? defaultBranch.trim() !== '' : folder.trim() !== '') &&
        !busy;

    useEffect(() => {
        if (job.status !== 'ready') return;
        void qc.invalidateQueries({ queryKey: ['projects', projectId, 'repos'] });
        toast.show({ message: `Repo added — ${job.repo?.name ?? name}` });
        onClose();
        // Keyed on the status alone: it fires once per finished clone, and
        // closing unmounts the dialog.
    }, [job.status]);

    function manageCredentials() {
        onClose();
        navigate('/settings/credentials');
    }

    function handleFolderChange(next: string) {
        setFolder(next);
        // Best-effort: fill the URL from the folder's origin.
        if (!next.trim()) return;
        void api.projects
            .folderOrigin(next.trim())
            .then(({ origin }) => {
                if (origin) setRepoUrl(origin);
            })
            .catch(() => {});
    }

    async function submit() {
        setSubmitError(null);
        setConnectError(null);
        try {
            if (mode === 'clone') {
                const res = await cloneRepo.mutateAsync({
                    name,
                    repo_url: repoUrl.trim(),
                    credential_id: credentialId,
                    default_branch: defaultBranch.trim(),
                });
                setCloneId(res.clone_id);
                return;
            }
            const res = await connectRepo.mutateAsync({
                name,
                folder_path: folder.trim(),
                repo_url: repoUrl.trim(),
                credential_id: credentialId,
            });
            if (res.ok) {
                toast.show({ message: `Repo added — ${name}` });
                onClose();
            } else if ('error_kind' in res.body) {
                setConnectError(res.body);
            } else {
                setSubmitError('error' in res.body ? res.body.error : 'Could not add the repo');
            }
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not add the repo');
        }
    }

    return (
        <Dialog
            open
            onClose={busy ? undefined : onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, p: 4, pb: 0 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>Add repo</FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Tasks in this project can then pick it alongside the others.
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small" disabled={busy} aria-label="Close">
                    <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                </IconButton>
            </Box>

            <Box sx={{ p: 4 }}>
                {connectError ? (
                    <ConnectErrorDetails error={connectError} folder={folder} repoUrl={repoUrl} />
                ) : cloneId ? (
                    <>
                        {job.status === 'error' ? (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {job.errorDetail}
                            </Alert>
                        ) : (
                            <LinearProgress sx={{ mb: 2 }} />
                        )}
                        <Box
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11.5,
                                color: ATLAS_PALETTE.slate70,
                                bgcolor: ATLAS_PALETTE.slate08,
                                borderRadius: '6px',
                                p: 2,
                                maxHeight: 200,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                            }}
                        >
                            {job.lines.length > 0 ? job.lines.join('\n') : 'Cloning…'}
                        </Box>
                    </>
                ) : (
                    <>
                        <ToggleButtonGroup
                            exclusive
                            fullWidth
                            size="small"
                            value={mode}
                            onChange={(_, next: Mode | null) => next && setMode(next)}
                            sx={{ mb: 3, '& .MuiToggleButton-root': { textTransform: 'none' } }}
                        >
                            <ToggleButton value="clone">Clone fresh</ToggleButton>
                            <ToggleButton value="connect">Use existing folder</ToggleButton>
                        </ToggleButtonGroup>

                        {mode === 'connect' && (
                            <>
                                <Typography sx={LABEL_SX}>Existing folder</Typography>
                                <Box sx={{ mb: 3 }}>
                                    <FolderPicker
                                        ariaLabel="Existing folder"
                                        value={folder}
                                        onChange={handleFolderChange}
                                        size="small"
                                        textFieldSx={inputSx}
                                    />
                                </Box>
                            </>
                        )}

                        <TextField
                            fullWidth
                            size="small"
                            required
                            label="Repository URL"
                            value={repoUrl}
                            onChange={(e) => setRepoUrl(e.target.value)}
                            placeholder="https://github.com/acme/orion-web.git"
                            helperText={
                                mode === 'clone'
                                    ? 'HTTPS · github.com only.'
                                    : "We verify this matches the folder's remote."
                            }
                            sx={{ mb: 3 }}
                        />

                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: {
                                    xs: '1fr',
                                    md: mode === 'clone' ? '1fr 1fr' : '1fr',
                                },
                                gap: 3,
                                mb: 3,
                            }}
                        >
                            <TextField
                                fullWidth
                                size="small"
                                required
                                label="Name"
                                value={name}
                                onChange={(e) => setNameChoice(e.target.value)}
                                error={nameInvalid}
                                helperText={
                                    nameInvalid
                                        ? 'Lowercase letters, digits and dashes (max 40).'
                                        : "The repo's folder in a Task's workspace."
                                }
                                slotProps={{ htmlInput: { style: { fontFamily: MONO } } }}
                            />
                            {mode === 'clone' && (
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Default branch"
                                    value={defaultBranch}
                                    onChange={(e) => setDefaultBranch(e.target.value)}
                                />
                            )}
                        </Box>

                        <CredentialSelect
                            credentials={credentials}
                            value={credentialId}
                            onChange={setCredentialChoice}
                            onManage={manageCredentials}
                        />
                    </>
                )}

                {submitError && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {submitError}
                    </Alert>
                )}

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                    <Button
                        onClick={onClose}
                        disabled={busy}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    {connectError ? (
                        <Button
                            variant="outlined"
                            onClick={() => setConnectError(null)}
                            sx={{ textTransform: 'none' }}
                        >
                            Edit details
                        </Button>
                    ) : job.status === 'error' ? (
                        <Button
                            variant="outlined"
                            onClick={() => setCloneId(null)}
                            sx={{ textTransform: 'none' }}
                        >
                            Edit details
                        </Button>
                    ) : (
                        !cloneId && (
                            <Button
                                variant="contained"
                                onClick={() => void submit()}
                                disabled={!canSubmit}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    bgcolor: ATLAS_PALETTE.green,
                                    boxShadow: 'none',
                                    '&:hover': {
                                        bgcolor: ATLAS_PALETTE.greenDark,
                                        boxShadow: 'none',
                                    },
                                }}
                            >
                                {mode === 'clone' ? 'Clone repo' : 'Verify & add'}
                            </Button>
                        )
                    )}
                </Box>
            </Box>
        </Dialog>
    );
}
