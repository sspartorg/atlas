import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Radio from '@mui/material/Radio';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { IProject } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useDeleteJob } from '../../hooks/useDeleteJob.js';
import { newJobId } from '../../hooks/sse-hub.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';

const MONO = '"JetBrains Mono", monospace';

type View = 'confirm' | 'deleting' | 'success' | 'error';
type Mode = 'unregister' | 'purge';

interface Props {
    open: boolean;
    project: IProject | null;
    displayId: string;
    onClose: () => void;
}

interface ChecklistStep {
    key: string;
    label: string;
}

// What delete-runner.ts does, in order. Purge removes the repo folders
// first, then the DB delete (CASCADE) unregisters the project.
const UNREGISTER_STEP: ChecklistStep = { key: 'unregister', label: 'Unregister from Atlas' };
const STEPS_BY_MODE: Record<Mode, ChecklistStep[]> = {
    unregister: [UNREGISTER_STEP],
    purge: [{ key: 'remove', label: 'Remove repo folders' }, UNREGISTER_STEP],
};

/** Index of the step in progress (steps.length once all are done). */
function deriveStepIndex(lines: string[], mode: Mode): number {
    const steps = STEPS_BY_MODE[mode];
    let idx = 0;
    for (const line of lines) {
        if (/Unregistering project/i.test(line)) idx = Math.max(idx, steps.indexOf(UNREGISTER_STEP));
        if (/Unregistering project.*\.\.\. ok/i.test(line)) idx = steps.length;
    }
    return idx;
}

const ConfirmChips = ({ items }: { items: string[] }) => (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }}>
        {items.map((label) => (
            <Box
                key={label}
                sx={{
                    px: 1.5,
                    py: 0.5,
                    bgcolor: ATLAS_PALETTE.slate08,
                    color: ATLAS_PALETTE.slate70,
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: '4px',
                }}
            >
                {label}
            </Box>
        ))}
    </Box>
);

function ProjectChip({ project, displayId }: { project: IProject; displayId: string }) {
    // ADR 0018 — the folders at stake are the project's repos, 0..N of them.
    const { data: repos = [] } = useProjectRepos(project.id);
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 3,
                p: 3,
                bgcolor: 'rgba(49,171,70,.06)',
                border: `1px solid rgba(49,171,70,.18)`,
                borderRadius: '10px',
            }}
        >
            <FolderOutlined sx={{ fontSize: 16, color: ATLAS_PALETTE.green, mt: '2px' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        {project.name}
                    </Typography>
                    <Box
                        sx={{
                            fontFamily: MONO,
                            fontSize: 10,
                            fontWeight: 600,
                            px: 1,
                            py: 0.25,
                            bgcolor: ATLAS_PALETTE.slate08,
                            color: ATLAS_PALETTE.slate70,
                            borderRadius: '4px',
                        }}
                    >
                        {displayId}
                    </Box>
                </Box>
                {repos.length === 0 ? (
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate70,
                            mt: 0.5,
                        }}
                    >
                        No repos
                    </Typography>
                ) : (
                    repos.map((repo) => (
                        <Typography
                            key={repo.id}
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                color: ATLAS_PALETTE.slate70,
                                mt: 0.5,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {repo.git_path}
                        </Typography>
                    ))
                )}
            </Box>
        </Box>
    );
}

export function DeleteProjectModal({ open, project, displayId, onClose }: Props) {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [view, setView] = useState<View>('confirm');
    const [mode, setMode] = useState<Mode>('unregister');
    const [confirmInput, setConfirmInput] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState<number>(0);
    const terminalRef = useRef<HTMLDivElement | null>(null);

    const job = useDeleteJob(deleteId);
    const projectId = project?.id;

    useEffect(() => {
        if (!open) {
            setView('confirm');
            setMode('unregister');
            setConfirmInput('');
            setDeleteId(null);
            setSubmitError(null);
            setStartedAt(null);
            setElapsedMs(0);
        }
    }, [open]);

    useEffect(() => {
        if (job.status === 'ready') {
            setView('success');
            // Covers both the unpaged list (sidenav / onboarding) and the
            // paged list the Projects page renders — useProjectsPaged nests
            // its key under ['projects'] so one invalidation reaches both.
            // Drop the detail cache first: a refetch would 404 and React Query
            // would keep showing the deleted project's last data.
            if (projectId) qc.removeQueries({ queryKey: ['projects', projectId] });
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
        } else if (job.status === 'error') {
            setView('error');
        }
    }, [job.status, qc, projectId]);

    useEffect(() => {
        if (view !== 'deleting' || !startedAt) return;
        const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
        return () => clearInterval(id);
    }, [view, startedAt]);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [job.lines.length]);

    const steps = STEPS_BY_MODE[mode];
    const stepIndex = useMemo(() => deriveStepIndex(job.lines, mode), [job.lines, mode]);

    function handleClose() {
        if (view === 'deleting') return;
        onClose();
        // The deleted project's own page has nothing left to show.
        if (view === 'success' && pathname !== '/projects') navigate('/projects');
    }

    async function startDeleteJob() {
        if (!project) return;
        setSubmitError(null);
        // Subscribe (via useDeleteJob) before the POST — see newJobId.
        const id = newJobId();
        setDeleteId(id);
        setStartedAt(Date.now());
        setElapsedMs(0);
        setView('deleting');
        try {
            const payload: { mode: Mode; confirm_name?: string; delete_id: string } = {
                mode,
                delete_id: id,
            };
            if (mode === 'purge') payload.confirm_name = confirmInput;
            await api.projects.deleteJob(project.id, payload);
        } catch (e) {
            setDeleteId(null);
            setView('confirm');
            setSubmitError(e instanceof Error ? e.message : 'Could not start delete');
        }
    }

    function backToProjects() {
        onClose();
        navigate('/projects');
    }

    const canSubmit =
        Boolean(project) &&
        (mode === 'unregister' || (mode === 'purge' && confirmInput === project?.name));

    if (!project) return null;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            disableEscapeKeyDown={view === 'deleting'}
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, p: 5, pb: 0 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        bgcolor:
                            view === 'success'
                                ? 'rgba(49,171,70,.12)'
                                : view === 'error'
                                  ? 'rgba(220,38,38,.10)'
                                  : view === 'deleting'
                                    ? 'rgba(220,38,38,.10)'
                                    : 'rgba(220,38,38,.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {view === 'success' ? (
                        <CheckCircleOutline sx={{ color: ATLAS_PALETTE.green, fontSize: 22 }} />
                    ) : view === 'error' ? (
                        <ErrorOutline sx={{ color: ATLAS_PALETTE.error, fontSize: 22 }} />
                    ) : view === 'deleting' ? (
                        <DeleteOutlineRounded sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }} />
                    ) : (
                        <WarningAmberRounded sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }} />
                    )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>
                        {view === 'confirm' && 'Delete project?'}
                        {view === 'deleting' && 'Deleting project…'}
                        {view === 'success' && 'Project deleted'}
                        {view === 'error' && 'Delete failed'}
                    </FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {view === 'confirm' && 'Choose what to remove. This cannot be undone.'}
                        {view === 'deleting' && 'Deleting in the background.'}
                        {view === 'success' &&
                            (job.mode === 'purge'
                                ? 'Workspace folder removed, registry cleaned.'
                                : 'Unregistered from Atlas. Workspace folder kept on disk.')}
                        {view === 'error' && 'A delete step failed.'}
                    </Typography>
                </Box>
                {view !== 'deleting' && (
                    <IconButton onClick={handleClose} size="small" aria-label="Close">
                        <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                    </IconButton>
                )}
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                <ProjectChip project={project} displayId={displayId} />

                {view === 'confirm' && (
                    <>
                        <Alert
                            icon={<WarningAmberRounded sx={{ color: ATLAS_PALETTE.warning }} />}
                            sx={{
                                mt: 4,
                                bgcolor: 'rgba(199,83,47,.08)',
                                border: `1px solid rgba(199,83,47,.22)`,
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.55 },
                            }}
                        >
                            <strong>
                                Both options permanently wipe every task, sub-task, agent run,
                                comment, and notification for this project.
                            </strong>{' '}
                            They differ only in whether the workspace folder on disk is kept.
                            Re-adding the repo later starts a fresh empty project — the history does
                            not come back.
                        </Alert>

                        <Typography
                            sx={{
                                mt: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 2,
                            }}
                        >
                            What should we delete?
                        </Typography>

                        <Box
                            onClick={() => setMode('unregister')}
                            sx={{
                                p: 3,
                                border: `2px solid ${mode === 'unregister' ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                                bgcolor:
                                    mode === 'unregister' ? 'rgba(0,122,201,.04)' : 'transparent',
                                borderRadius: '10px',
                                display: 'flex',
                                gap: 2,
                                cursor: 'pointer',
                                mb: 2,
                            }}
                        >
                            <Radio
                                checked={mode === 'unregister'}
                                onChange={() => setMode('unregister')}
                                name="delete-mode"
                                size="small"
                                slotProps={{ input: { 'aria-label': 'Remove from Atlas only' } }}
                                sx={{ p: 0, mt: 0.5 }}
                            />
                            <Box sx={{ flex: 1 }}>
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                    }}
                                >
                                    Remove from Atlas only
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        mt: 0.5,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    Unregister the project from Atlas. The
                                    workspace folder on disk is kept untouched, so you can still
                                    open it in your editor — but the project's DB content (all
                                    issues, runs, comments, notifications) is wiped and cannot be
                                    recovered.
                                </Typography>
                                <ConfirmChips
                                    items={[
                                        'folder kept',
                                        'all issues wiped',
                                        'runs + history wiped',
                                    ]}
                                />
                            </Box>
                        </Box>

                        <Box
                            onClick={() => setMode('purge')}
                            sx={{
                                p: 3,
                                border: `2px solid ${mode === 'purge' ? ATLAS_PALETTE.error : ATLAS_PALETTE.slate10}`,
                                bgcolor: mode === 'purge' ? 'rgba(220,38,38,.04)' : 'transparent',
                                borderRadius: '10px',
                                display: 'flex',
                                gap: 2,
                                cursor: 'pointer',
                            }}
                        >
                            <Radio
                                checked={mode === 'purge'}
                                onChange={() => setMode('purge')}
                                name="delete-mode"
                                size="small"
                                slotProps={{ input: { 'aria-label': 'Delete project and content' } }}
                                sx={{ p: 0, mt: 0.5 }}
                            />
                            <Box sx={{ flex: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        Delete project and content
                                    </Typography>
                                    <Box
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 9,
                                            fontWeight: 700,
                                            px: 1,
                                            py: 0.25,
                                            bgcolor: 'rgba(220,38,38,.12)',
                                            color: ATLAS_PALETTE.error,
                                            borderRadius: '4px',
                                            letterSpacing: '0.05em',
                                        }}
                                    >
                                        DESTRUCTIVE
                                    </Box>
                                </Box>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        mt: 0.5,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    Everything above, plus recursively remove the workspace folder
                                    from disk. Uncommitted local changes will be lost. The remote
                                    git repo is untouched.
                                </Typography>
                                <ConfirmChips
                                    items={[
                                        'folder wiped',
                                        'all issues wiped',
                                        'runs + history wiped',
                                    ]}
                                />
                                {mode === 'purge' && (
                                    <Box sx={{ mt: 2 }}>
                                        <Alert
                                            icon={
                                                <WarningAmberRounded
                                                    sx={{ color: ATLAS_PALETTE.error }}
                                                />
                                            }
                                            sx={{
                                                bgcolor: 'rgba(220,38,38,.06)',
                                                border: `1px solid rgba(220,38,38,.18)`,
                                                color: ATLAS_PALETTE.slate,
                                                mb: 2,
                                                '& .MuiAlert-message': { fontSize: 12 },
                                            }}
                                        >
                                            Type{' '}
                                            <Box
                                                component="span"
                                                sx={{ fontFamily: MONO, fontWeight: 600 }}
                                            >
                                                {project.name}
                                            </Box>{' '}
                                            to confirm.
                                        </Alert>
                                        <TextField
                                            fullWidth
                                            size="small"
                                            value={confirmInput}
                                            onChange={(e) => setConfirmInput(e.target.value)}
                                            placeholder={project.name}
                                            sx={{
                                                '& .MuiOutlinedInput-root': {
                                                    fontFamily: MONO,
                                                    fontSize: 13,
                                                },
                                            }}
                                        />
                                    </Box>
                                )}
                            </Box>
                        </Box>

                        {submitError && (
                            <Alert
                                severity="error"
                                sx={{
                                    mt: 3,
                                    fontSize: 12,
                                    '& .MuiAlert-message': { fontSize: 12 },
                                }}
                            >
                                {submitError}
                            </Alert>
                        )}

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Cancel
                            </Button>
                            {mode === 'unregister' ? (
                                <Button
                                    variant="contained"
                                    onClick={() => void startDeleteJob()}
                                    disabled={!canSubmit}
                                    sx={{
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        bgcolor: ATLAS_PALETTE.brandBlue,
                                        '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue },
                                    }}
                                >
                                    Remove from Atlas
                                </Button>
                            ) : (
                                <Button
                                    variant="contained"
                                    color="error"
                                    onClick={() => void startDeleteJob()}
                                    disabled={!canSubmit}
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    Delete project and content
                                </Button>
                            )}
                        </Box>
                    </>
                )}

                {view === 'deleting' && (
                    <>
                        <Box sx={{ mt: 4, mb: 4 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography
                                    sx={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    Step {Math.min(stepIndex + 1, steps.length)} of {steps.length}{' '}
                                    · {steps[Math.min(stepIndex, steps.length - 1)]?.label}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {Math.floor(elapsedMs / 1000)}s
                                </Typography>
                            </Box>
                            <LinearProgress
                                variant="determinate"
                                value={(stepIndex / steps.length) * 100}
                                sx={{
                                    height: 6,
                                    borderRadius: 3,
                                    bgcolor: ATLAS_PALETTE.slate08,
                                    '& .MuiLinearProgress-bar': { bgcolor: ATLAS_PALETTE.error },
                                }}
                            />
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4 }}>
                            {steps.map((s, i) => {
                                const done = i < stepIndex;
                                const active = i === stepIndex;
                                return (
                                    <Box
                                        key={s.key}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 2,
                                            p: 2,
                                            border: `1px solid ${active ? ATLAS_PALETTE.error : ATLAS_PALETTE.slate10}`,
                                            bgcolor: active ? 'rgba(220,38,38,.04)' : 'transparent',
                                            borderRadius: '8px',
                                        }}
                                    >
                                        {done ? (
                                            <CheckCircleOutline
                                                sx={{ color: ATLAS_PALETTE.green, fontSize: 18 }}
                                            />
                                        ) : active ? (
                                            <CircularProgress
                                                size={16}
                                                sx={{ color: ATLAS_PALETTE.error }}
                                            />
                                        ) : (
                                            <RadioButtonUnchecked
                                                sx={{ color: ATLAS_PALETTE.slate30, fontSize: 18 }}
                                            />
                                        )}
                                        <Typography
                                            sx={{
                                                fontSize: 13,
                                                color:
                                                    done || active
                                                        ? ATLAS_PALETTE.slate
                                                        : ATLAS_PALETTE.slate60,
                                                fontWeight: active ? 600 : 400,
                                            }}
                                        >
                                            {s.label}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>

                        <Typography
                            sx={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1,
                            }}
                        >
                            Live output
                        </Typography>
                        <Box
                            ref={terminalRef}
                            sx={{
                                bgcolor: ATLAS_PALETTE.terminalBg,
                                color: ATLAS_PALETTE.terminalFgOk,
                                fontFamily: MONO,
                                fontSize: 11,
                                lineHeight: 1.6,
                                borderRadius: '8px',
                                p: 3,
                                height: 160,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {job.lines.slice(-200).join('\n') || 'Waiting for output…'}
                        </Box>

                        <Box
                            sx={{
                                mt: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                Closing disabled — deletion in progress
                            </Typography>
                            <Button
                                variant="contained"
                                color="error"
                                disabled
                                startIcon={<CircularProgress size={14} color="inherit" />}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Deleting…
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'success' && (
                    <>
                        <Alert
                            icon={<CheckCircleOutline sx={{ color: ATLAS_PALETTE.green }} />}
                            sx={{
                                mt: 4,
                                bgcolor: 'rgba(49,171,70,.08)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            {job.mode === 'purge' ? (
                                <>
                                    <strong>
                                        Removed in {Math.max(1, Math.round(elapsedMs / 1000))}s
                                    </strong>
                                    <Box
                                        sx={{
                                            fontSize: 12,
                                            color: ATLAS_PALETTE.slate70,
                                            mt: 0.5,
                                        }}
                                    >
                                        Repo folders inside the workspace deleted, project
                                        unregistered. All issues, runs, comments, and notifications
                                        wiped from Atlas.
                                    </Box>
                                </>
                            ) : (
                                <>
                                    <strong>
                                        Unregistered in {Math.max(1, Math.round(elapsedMs / 1000))}s
                                        · workspace folder kept on disk
                                    </strong>
                                    <Box
                                        sx={{
                                            fontSize: 12,
                                            color: ATLAS_PALETTE.slate70,
                                            mt: 0.5,
                                        }}
                                    >
                                        All issues, runs, comments, and notifications for this
                                        project have been wiped. Re-adding the repo starts a fresh
                                        empty project.
                                    </Box>
                                </>
                            )}
                        </Alert>

                        <Typography
                            sx={{
                                mt: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1,
                            }}
                        >
                            Transcript
                        </Typography>
                        <Box
                            sx={{
                                bgcolor: ATLAS_PALETTE.terminalBg,
                                color: ATLAS_PALETTE.terminalFgOk,
                                fontFamily: MONO,
                                fontSize: 11,
                                lineHeight: 1.6,
                                borderRadius: '8px',
                                p: 3,
                                maxHeight: 160,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {job.lines.slice(-30).join('\n')}
                            {`\n\nCompleted in ${Math.max(1, Math.round(elapsedMs / 1000))}s`}
                        </Box>

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Close
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                onClick={backToProjects}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Back to projects →
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'error' && (
                    <>
                        <Alert
                            severity="error"
                            icon={<ErrorOutline sx={{ color: ATLAS_PALETTE.error }} />}
                            sx={{
                                mt: 4,
                                bgcolor: 'rgba(220,38,38,.06)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            <strong>Delete failed</strong>
                            <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                See the output below.
                            </Box>
                        </Alert>

                        <Typography
                            sx={{
                                mt: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1,
                            }}
                        >
                            Error output
                        </Typography>
                        <Box
                            sx={{
                                bgcolor: ATLAS_PALETTE.terminalBg,
                                color: ATLAS_PALETTE.terminalFgErr,
                                fontFamily: MONO,
                                fontSize: 11,
                                lineHeight: 1.6,
                                borderRadius: '8px',
                                p: 3,
                                maxHeight: 200,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {job.errorDetail ||
                                job.lines.slice(-30).join('\n') ||
                                'No stderr captured.'}
                        </Box>

                        <Box
                            sx={{ mt: 3, p: 3, bgcolor: ATLAS_PALETTE.cloud, borderRadius: '8px' }}
                        >
                            <Typography
                                sx={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    color: ATLAS_PALETTE.slate60,
                                    mb: 1.5,
                                }}
                            >
                                Try
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                {(mode === 'purge'
                                    ? [
                                          'Close any editor or terminal that has the workspace folder open',
                                          'Check the workspace path still exists on disk',
                                          'Inspect the server log for the exact error',
                                      ]
                                    : [
                                          'Check the server logs',
                                          'Make sure the API can reach its Postgres database',
                                      ]
                                ).map((t) => (
                                    <Box
                                        key={t}
                                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
                                    >
                                        <RadioButtonUnchecked
                                            sx={{ fontSize: 14, color: ATLAS_PALETTE.slate40 }}
                                        />
                                        <Typography
                                            sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70 }}
                                        >
                                            {t}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={onClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Close
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={() => {
                                    setDeleteId(null);
                                    setView('confirm');
                                }}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Try again
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Dialog>
    );
}
