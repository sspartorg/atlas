import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CircularProgress from '@mui/material/CircularProgress';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import type { AgentCli, ICliSession } from '@atlas/shared';
import { DEFAULT_MODEL_BY_CLI } from '@atlas/shared';
import { CLI_OPTIONS } from '../utils/cliPresentation.js';
import { FolderPicker } from './FolderPicker.js';
import { useCreateStandaloneCliSession } from '../hooks/useCliSessions.js';
import { useCliModels } from '../hooks/useCliModels.js';
import { useCredentials } from '../hooks/useCredentials.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// Standalone terminal — a PTY on a folder you pick, under a credential you
// pick. Deliberately NOT a mode on `StartSessionDialog`: there is no project,
// no item, no branch and no worktree here, so sharing that form would mean
// hiding more fields than it shows.

const NO_CREDENTIAL = '';

interface StartStandaloneSessionDialogProps {
    open: boolean;
    onClose: () => void;
    onCreated: (s: ICliSession) => void;
}

export function StartStandaloneSessionDialog({
    open,
    onClose,
    onCreated,
}: StartStandaloneSessionDialogProps) {
    const { data: cliModels = [] } = useCliModels();
    const { data: credentials = [] } = useCredentials();
    const createMutation = useCreateStandaloneCliSession();
    const toast = useToast();

    const [folderPath, setFolderPath] = useState('');
    const [credentialId, setCredentialId] = useState<string>(NO_CREDENTIAL);
    const [title, setTitle] = useState('');
    const [initialPrompt, setInitialPrompt] = useState('');
    const [cli, setCli] = useState<AgentCli>('claude');
    const [model, setModel] = useState(DEFAULT_MODEL_BY_CLI.claude);

    // No guard for a credential deleted while this dialog is open: the server
    // 404s on a dangling id and the error toast below says so. Reconciling the
    // select against a live list would be more code for the same outcome.

    const modelsForCli = useMemo(
        () => cliModels.filter((m) => m.cli === cli),
        [cliModels, cli],
    );
    const defaultModelForCli = DEFAULT_MODEL_BY_CLI[cli];

    function handleCliChange(_: unknown, next: AgentCli | null) {
        if (!next || next === cli) return;
        setCli(next);
        // The previously selected model belongs to another CLI's registry, so
        // reset to this CLI's default (same reasoning as StartSessionDialog).
        setModel(DEFAULT_MODEL_BY_CLI[next]);
    }

    function reset() {
        setFolderPath('');
        setCredentialId(NO_CREDENTIAL);
        setTitle('');
        setInitialPrompt('');
        setCli('claude');
        setModel(DEFAULT_MODEL_BY_CLI.claude);
    }

    function handleClose() {
        if (createMutation.isPending) return;
        reset();
        onClose();
    }

    function handleStart() {
        const trimmedFolder = folderPath.trim();
        if (!trimmedFolder) return;
        const trimmedTitle = title.trim();
        const trimmedPrompt = initialPrompt.trim();
        const input: Parameters<typeof createMutation.mutate>[0] = {
            folder_path: trimmedFolder,
            cli,
            model: model || defaultModelForCli,
        };
        if (credentialId) input.credential_id = credentialId;
        if (trimmedTitle) input.title = trimmedTitle;
        if (trimmedPrompt) input.initial_prompt = trimmedPrompt;
        createMutation.mutate(input, {
            onSuccess: (created) => {
                reset();
                onCreated(created);
            },
            onError: (err: Error) => {
                toast.show({ message: 'Could not open terminal', detail: err.message });
            },
        });
    }

    const accent = ATLAS_PALETTE.green;
    const isPending = createMutation.isPending;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            PaperProps={{
                sx: {
                    width: 720,
                    maxWidth: '92vw',
                    borderRadius: '14px',
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                },
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 2,
                    px: 4,
                    pt: 3,
                    pb: 2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
                    <FolderOpenRounded sx={{ color: accent, fontSize: 22, mt: 0.25 }} />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography
                            sx={{
                                fontSize: 18,
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.2,
                            }}
                        >
                            Open a standalone terminal
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                            Runs the CLI directly in the folder you pick. No worktree, no branch,
                            and nothing written into the folder.
                        </Typography>
                    </Box>
                </Box>
                <IconButton
                    onClick={handleClose}
                    size="small"
                    disabled={isPending}
                    sx={{ color: ATLAS_PALETTE.slate60, flexShrink: 0 }}
                >
                    <CloseRounded fontSize="small" />
                </IconButton>
            </Box>

            <Box sx={{ px: 4, pt: 1, pb: 3, maxHeight: '62vh', overflow: 'auto' }}>
                <Box sx={{ mb: 3 }}>
                    <Typography
                        variant="caption"
                        sx={{ display: 'block', color: ATLAS_PALETTE.slate60, mb: 1 }}
                    >
                        CLI
                    </Typography>
                    <ToggleButtonGroup
                        value={cli}
                        exclusive
                        onChange={handleCliChange}
                        disabled={isPending}
                        size="small"
                        fullWidth
                    >
                        {CLI_OPTIONS.map((opt) => (
                            <ToggleButton
                                key={opt.value}
                                value={opt.value}
                                sx={{ textTransform: 'none' }}
                            >
                                {opt.label}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Box>

                <Box sx={{ mb: 3 }}>
                    <Typography
                        variant="caption"
                        sx={{ display: 'block', color: ATLAS_PALETTE.slate60, mb: 1 }}
                    >
                        Folder
                    </Typography>
                    <FolderPicker
                        value={folderPath}
                        onChange={setFolderPath}
                        placeholder="Pick any folder on this machine"
                        size="small"
                        onEnterCommit={handleStart}
                    />
                </Box>

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                        columnGap: 4,
                        rowGap: 3,
                        mb: 3,
                    }}
                >
                    <TextField
                        select
                        size="small"
                        label="Git credentials"
                        value={credentialId}
                        onChange={(e) => setCredentialId(e.target.value)}
                        fullWidth
                        disabled={isPending}
                        helperText="Authenticates git and gh inside this session. Set a name and email on the credential to also own the commits."
                    >
                        <MenuItem value={NO_CREDENTIAL}>
                            This machine&apos;s git config
                        </MenuItem>
                        {credentials.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                                {c.label}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        select
                        size="small"
                        label="Model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        fullWidth
                        disabled={isPending}
                    >
                        {modelsForCli.length === 0 ? (
                            <MenuItem value={defaultModelForCli}>{defaultModelForCli}</MenuItem>
                        ) : (
                            modelsForCli.map((m) => (
                                <MenuItem key={m.id} value={m.model_name}>
                                    {m.model_name}
                                    {m.note ? ` — ${m.note}` : ''}
                                </MenuItem>
                            ))
                        )}
                    </TextField>
                </Box>

                <Box sx={{ mb: 3 }}>
                    <TextField
                        size="small"
                        label="Title (optional)"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Defaults to the folder name"
                        fullWidth
                        disabled={isPending}
                    />
                </Box>

                <TextField
                    size="small"
                    label="Initial prompt (optional)"
                    value={initialPrompt}
                    onChange={(e) => setInitialPrompt(e.target.value)}
                    placeholder="e.g. What files are in this repo?"
                    helperText="Typed into the PTY after the welcome screen renders."
                    multiline
                    minRows={2}
                    maxRows={6}
                    fullWidth
                    disabled={isPending}
                />
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    px: 4,
                    py: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                }}
            >
                <Button
                    onClick={handleClose}
                    disabled={isPending}
                    sx={{ color: ATLAS_PALETTE.slate60, textTransform: 'none' }}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleStart}
                    disabled={!folderPath.trim() || isPending}
                    startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : <AddRounded />}
                    sx={{
                        textTransform: 'none',
                        background: ATLAS_PALETTE.green,
                        '&:hover': { background: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {isPending ? 'Opening…' : 'Open terminal'}
                </Button>
            </Box>
        </Dialog>
    );
}
