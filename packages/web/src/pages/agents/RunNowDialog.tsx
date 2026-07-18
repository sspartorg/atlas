import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMutation } from '@tanstack/react-query';
import type { IAgent, IssueType } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useEpics } from '../../hooks/useEpics.js';
import { useStories } from '../../hooks/useStories.js';
import { useBugs } from '../../hooks/useBugs.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { PromptPreviewDialog } from './PromptPreviewDialog.js';
import { ApiErrorAlert } from '../../components/ApiErrorAlert.js';

interface Props {
    open: boolean;
    agent: IAgent;
    onClose: () => void;
    // Pre-fill the picker when the dialog is opened from a context that already
    // knows the target — e.g. the Queue page's per-agent "Run now" button,
    // which passes the agent's next-scheduled item. The owner can still change
    // any of the three fields before running. Omit `preselect` and the dialog
    // opens empty as before.
    preselect?: {
        projectId: string | null;
        kind: IssueType;
        issueId: string;
    } | null;
}

type Kind = Extract<IssueType, 'epic' | 'story' | 'bug'>;

const KIND_LABEL: Record<Kind, string> = {
    epic: 'Epic',
    story: 'Story',
    bug: 'Bug',
};

function isKind(t: IssueType): t is Kind {
    return t === 'epic' || t === 'story' || t === 'bug';
}

export function RunNowDialog({ open, agent, onClose, preselect = null }: Props) {
    const navigate = useNavigate();
    const toast = useToast();

    const { data: projects = [] } = useProjects();
    const [projectId, setProjectId] = useState<string>('');
    const [kind, setKind] = useState<Kind>('story');
    const [issueId, setIssueId] = useState<string>('');

    useEffect(() => {
        if (!open) {
            setProjectId('');
            setKind('story');
            setIssueId('');
            return;
        }
        // Hydrate from preselect on open. Sub-task / sub-bug aren't yet a
        // launch target — fall back to the default kind for those so the
        // picker still opens with the parent project chosen.
        if (preselect) {
            setProjectId(preselect.projectId ?? '');
            if (isKind(preselect.kind)) {
                setKind(preselect.kind);
                setIssueId(preselect.issueId);
            } else {
                setKind('story');
                setIssueId('');
            }
        }
    }, [open, preselect]);

    useEffect(() => {
        if (!projectId && projects[0]) setProjectId(projects[0].id);
    }, [projects, projectId]);

    const { data: epics = [] } = useEpics(projectId || undefined);
    const { data: stories = [] } = useStories({ projectId: projectId || undefined });
    const { data: bugs = [] } = useBugs({ projectId: projectId || undefined });

    const issues = useMemo(() => {
        if (kind === 'epic') return epics.map((e) => ({ id: e.id, title: e.title }));
        if (kind === 'story') return stories.map((s) => ({ id: s.id, title: s.title }));
        return bugs.map((b) => ({ id: b.id, title: b.title }));
    }, [kind, epics, stories, bugs]);

    // (issueId clears in the onChange handlers below, not via an effect on
    // projectId/kind — the effect approach would wipe a preselect right after
    // the open-effect hydrated it.)

    const isFreedom = agent.requires_item === false;

    const triggerRun = useMutation({
        mutationFn: () =>
            isFreedom
                ? api.run.trigger(agent.id, null, null)
                : api.run.trigger(agent.id, kind as IssueType, issueId),
        onSuccess: ({ runId }) => {
            toast.show({ message: `${agent.name} run queued`, detail: runId.slice(0, 8) });
            onClose();
            navigate(`/agents/${agent.id}/runs/${runId}`);
        },
        onError: (e) =>
            toast.show({
                message: 'Could not start run',
                detail: (e as Error).message,
            }),
    });

    const [previewOpen, setPreviewOpen] = useState(false);
    const compilePreview = useMutation({
        mutationFn: () =>
            isFreedom
                ? api.agents.compilePrompt(agent.id, null, null)
                : api.agents.compilePrompt(agent.id, kind as IssueType, issueId),
        onMutate: () => {
            setPreviewOpen(true);
        },
        onError: (e) => {
            setPreviewOpen(false);
            toast.show({
                message: 'Could not compile prompt',
                detail: (e as Error).message,
            });
        },
    });

    const canSubmit =
        (isFreedom || Boolean(projectId && issueId)) && !triggerRun.isPending;
    const canPreview =
        (isFreedom || Boolean(projectId && issueId)) &&
        !compilePreview.isPending &&
        !triggerRun.isPending;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: { borderRadius: '12px' } }}
        >
            <DialogTitle
                sx={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                {isFreedom ? `Run ${agent.name}` : `Run ${agent.name} on an issue`}
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate60,
                        mb: 3,
                    }}
                >
                    {isFreedom
                        ? `This agent runs in freedom mode (requires_item = false). No item needed — the run will spawn immediately and stream output into its Runs tab.`
                        : `Picks the target now; the agent will queue immediately and stream output into its Runs tab.`}
                </Typography>

                {/* W4 — typed alert for /api/run failures. Shows MCP-token,
                    CLI-not-installed, validation, etc. inline so the user
                    doesn't have to read the toast and re-open the dialog. */}
                {triggerRun.error && (
                    <Box sx={{ mb: 2 }}>
                        <ApiErrorAlert
                            error={triggerRun.error}
                            contextLabel="Couldn't start run"
                        />
                    </Box>
                )}

                {isFreedom ? null : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <TextField
                        select
                        label="Project"
                        value={projectId}
                        onChange={(e) => {
                            setProjectId(e.target.value);
                            setIssueId('');
                        }}
                        size="small"
                        fullWidth
                    >
                        {projects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                <Box
                                    component="span"
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        color: ATLAS_PALETTE.slate60,
                                        fontSize: 11.5,
                                        mr: 1,
                                    }}
                                >
                                    {p.issue_key_prefix}
                                </Box>
                                {p.name}
                            </MenuItem>
                        ))}
                        {projects.length === 0 ? (
                            <MenuItem value="" disabled>
                                No projects yet
                            </MenuItem>
                        ) : null}
                    </TextField>

                    <TextField
                        select
                        label="Issue type"
                        value={kind}
                        onChange={(e) => {
                            setKind(e.target.value as Kind);
                            setIssueId('');
                        }}
                        size="small"
                        fullWidth
                    >
                        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                            <MenuItem key={k} value={k}>
                                {KIND_LABEL[k]}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select
                        label={KIND_LABEL[kind]}
                        // Race-guard: when the dialog opens with `issueId`
                        // carried from a prior session but the `issues`
                        // query hasn't resolved yet, the option list is
                        // empty and MUI logs "out-of-range value MON-N".
                        // Falling back to '' until the matching option
                        // exists silences the warning; the Select snaps to
                        // the real value once the option lands.
                        value={
                            issues.some((it) => it.id === issueId) ? issueId : ''
                        }
                        onChange={(e) => setIssueId(e.target.value)}
                        size="small"
                        fullWidth
                        disabled={!projectId || issues.length === 0}
                        helperText={
                            !projectId
                                ? 'Pick a project first'
                                : issues.length === 0
                                  ? `No ${KIND_LABEL[kind].toLowerCase()}s in this project yet`
                                  : undefined
                        }
                    >
                        {issues.map((it) => (
                            <MenuItem key={it.id} value={it.id}>
                                <Box
                                    component="span"
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        color: ATLAS_PALETTE.slate60,
                                        fontSize: 11.5,
                                        mr: 1,
                                    }}
                                >
                                    {it.id}
                                </Box>
                                {it.title}
                            </MenuItem>
                        ))}
                    </TextField>
                </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3, gap: 1, flexWrap: 'wrap' }}>
                <Button
                    onClick={onClose}
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                >
                    Cancel
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                    variant="outlined"
                    onClick={() => compilePreview.mutate()}
                    disabled={!canPreview}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            visibility
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        color: ATLAS_PALETTE.brandBlue,
                        borderColor: ATLAS_PALETTE.slate12,
                        bgcolor: ATLAS_PALETTE.white,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                            bgcolor: ATLAS_PALETTE.cloud,
                        },
                    }}
                >
                    {compilePreview.isPending ? 'Compiling…' : 'Preview prompt'}
                </Button>
                <Button
                    variant="contained"
                    onClick={() => triggerRun.mutate()}
                    disabled={!canSubmit}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            play_arrow
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {triggerRun.isPending ? 'Starting…' : 'Run now'}
                </Button>
            </DialogActions>

            <PromptPreviewDialog
                open={previewOpen}
                data={compilePreview.data ?? null}
                onClose={() => setPreviewOpen(false)}
            />
        </Dialog>
    );
}
