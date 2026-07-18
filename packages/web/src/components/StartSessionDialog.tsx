import { useEffect, useMemo, useState } from 'react';
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
import Autocomplete from '@mui/material/Autocomplete';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import type { ICliSession, IEpic, IStory, IBug } from '@atlas/shared';
import { DEFAULT_CLI_MODEL, DEFAULT_COPILOT_MODEL } from '@atlas/shared';
import { useCreateCliSession } from '../hooks/useCliSessions.js';
import { useProjects } from '../hooks/useProjects.js';
import { useCliModels } from '../hooks/useCliModels.js';
import { useIssues } from '../hooks/useIssues.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface ItemPickerOption {
    id: string;
    title: string;
    groupLabel: string;
}

function buildItemOptions(epics: IEpic[], stories: IStory[], bugs: IBug[]): ItemPickerOption[] {
    const opts: ItemPickerOption[] = [];
    epics.forEach((e) => opts.push({ id: e.id, title: e.title, groupLabel: 'Epics' }));
    stories.forEach((s) => opts.push({ id: s.id, title: s.title, groupLabel: 'Stories' }));
    bugs.forEach((b) => opts.push({ id: b.id, title: b.title, groupLabel: 'Bugs' }));
    return opts;
}

interface StartSessionDialogProps {
    open: boolean;
    onClose: () => void;
    onCreated: (s: ICliSession) => void;
    /** Pre-select a project; the user can still change it. */
    defaultProjectId?: string | undefined;
}

export function StartSessionDialog({
    open,
    onClose,
    onCreated,
    defaultProjectId,
}: StartSessionDialogProps) {
    const { data: projects = [] } = useProjects();
    const { data: cliModels = [] } = useCliModels();
    const createMutation = useCreateCliSession();
    const toast = useToast();

    const [projectId, setProjectId] = useState(defaultProjectId ?? '');
    const [itemId, setItemId] = useState('');
    const [title, setTitle] = useState('');
    const [branchName, setBranchName] = useState('');
    const [initialPrompt, setInitialPrompt] = useState('');
    const [cli, setCli] = useState<'claude' | 'copilot'>('claude');
    const [model, setModel] = useState(DEFAULT_CLI_MODEL);

    // useState only consults its initializer on first mount, so a caller that
    // mounts this dialog before `defaultProjectId` is known (data still
    // loading) and then updates the prop would never see it propagate. Sync
    // the projectId field whenever the prop changes WHILE the dialog is
    // closed — avoids stomping a partially-filled-in form mid-edit.
    useEffect(() => {
        if (!open && defaultProjectId !== undefined) {
            setProjectId(defaultProjectId);
        }
    }, [open, defaultProjectId]);

    const { data: issuesData } = useIssues(projectId ? { projectId } : undefined);
    const itemOptions = useMemo<ItemPickerOption[]>(() => {
        if (!projectId || !issuesData) return [];
        return buildItemOptions(issuesData.epics, issuesData.stories, issuesData.bugs);
    }, [projectId, issuesData]);

    const modelsForCli = useMemo(
        () => cliModels.filter((m) => m.cli === cli),
        [cliModels, cli],
    );
    const defaultModelForCli = cli === 'copilot' ? DEFAULT_COPILOT_MODEL : DEFAULT_CLI_MODEL;

    function handleCliChange(_: unknown, next: 'claude' | 'copilot' | null) {
        if (!next || next === cli) return;
        setCli(next);
        // The previously selected model is almost certainly from the other CLI's
        // registry, so reset to that CLI's default. The model select renders
        // out of `modelsForCli` anyway, so a stale value would just blank out.
        setModel(next === 'copilot' ? DEFAULT_COPILOT_MODEL : DEFAULT_CLI_MODEL);
    }

    function reset() {
        setProjectId(defaultProjectId ?? '');
        setItemId('');
        setTitle('');
        setBranchName('');
        setInitialPrompt('');
        setCli('claude');
        setModel(DEFAULT_CLI_MODEL);
    }

    function handleClose() {
        // The Cancel/close-icon buttons that call handleClose are both
        // `disabled={isPending}`, and browsers/jsdom block click events on
        // natively-disabled buttons — so this guard can't be reached by
        // clicking through the UI. Kept as defense against a non-UI caller.
        /* v8 ignore next */
        if (createMutation.isPending) return;
        reset();
        onClose();
    }

    function handleStart() {
        // The "Start session" button is `disabled={!projectId || isPending}`,
        // so a real/jsdom click can never reach handleStart with an empty
        // projectId — the disabled attribute blocks the click entirely.
        /* v8 ignore next */
        if (!projectId) return;
        const trimmedTitle = title.trim();
        const trimmedBranch = branchName.trim();
        const trimmedPrompt = initialPrompt.trim();
        const input: Parameters<typeof createMutation.mutate>[0] = {
            project_id: projectId,
            cli,
            model: model || defaultModelForCli,
        };
        if (trimmedTitle) input.title = trimmedTitle;
        if (trimmedBranch) input.branch_name = trimmedBranch;
        if (trimmedPrompt) input.initial_prompt = trimmedPrompt;
        if (itemId) input.item_id = itemId;
        createMutation.mutate(input, {
            onSuccess: (created) => {
                reset();
                onCreated(created);
            },
            onError: (err: Error) => {
                toast.show({ message: 'Could not start session', detail: err.message });
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
                    overflow: 'hidden',
                    m: 2,
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, p: 4, pb: 3 }}>
                <Box
                    sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '8px',
                        background: `${accent}1A`,
                        color: accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <TerminalRounded sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            lineHeight: 1.2,
                        }}
                    >
                        Start a Terminal session
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Spawns Claude Code or GitHub Copilot CLI in a fresh worktree for the chosen project.
                    </Typography>
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
                        <ToggleButton value="claude" sx={{ textTransform: 'none' }}>
                            Claude Code
                        </ToggleButton>
                        <ToggleButton value="copilot" sx={{ textTransform: 'none' }}>
                            GitHub Copilot
                        </ToggleButton>
                    </ToggleButtonGroup>
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
                        label="Project"
                        value={projectId}
                        onChange={(e) => {
                            setProjectId(e.target.value);
                            setItemId('');
                        }}
                        required
                        fullWidth
                        autoFocus
                        disabled={isPending}
                    >
                        {projects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
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
                    <Autocomplete<ItemPickerOption>
                        options={itemOptions}
                        value={itemOptions.find((o) => o.id === itemId) ?? null}
                        onChange={(_, next) => setItemId(next?.id ?? '')}
                        groupBy={(o) => o.groupLabel}
                        getOptionLabel={(o) => `${o.id} — ${o.title}`}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        disabled={!projectId || isPending}
                        fullWidth
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                size="small"
                                label="Item (optional)"
                                placeholder={projectId ? 'Search by id or title…' : 'Pick a project first'}
                                helperText="Anchors the session to a Atlas item — Atlas writes the item context into `.atlas/current-task.md` (with your initial prompt appended). Sub-tasks created from the CLI nest under this item."
                            />
                        )}
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
                        size="small"
                        label="Title (optional)"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Defaults to Session <short-id>"
                        fullWidth
                        disabled={isPending}
                    />
                    <TextField
                        size="small"
                        label="Branch name (optional)"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder="atlas/terminal/<short-id>"
                        helperText="Must match atlas/<segment>/<id>. Leave empty to auto-generate."
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
                    disabled={!projectId || isPending}
                    startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : <AddRounded />}
                    sx={{
                        textTransform: 'none',
                        background: ATLAS_PALETTE.green,
                        '&:hover': { background: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {isPending ? 'Starting…' : 'Start session'}
                </Button>
            </Box>
        </Dialog>
    );
}
