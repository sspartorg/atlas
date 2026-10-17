import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { useNavigate } from 'react-router-dom';
import CloseRounded from '@mui/icons-material/CloseRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import ArrowForward from '@mui/icons-material/ArrowForward';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IProject, IProjectRepo } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useRecloneJob } from '../../hooks/useRecloneJob.js';
import { newJobId } from '../../hooks/sse-hub.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';

const MONO = '"JetBrains Mono", monospace';

type View = 'confirm' | 'running' | 'success' | 'error';

interface Props {
    open: boolean;
    project: IProject | null;
    /** ADR 0018 — a pull acts on one repo of the project. */
    repo: IProjectRepo | null;
    displayId: string;
    onClose: () => void;
}

interface ChecklistStep {
    key: string;
    label: string;
}

// What reclone-runner.ts does, in order: no clone, no re-index.
const STEPS: ChecklistStep[] = [
    { key: 'stash', label: 'Stash local changes' },
    { key: 'fetch', label: 'Fetch from remote' },
    { key: 'ff', label: 'Fast-forward default branch' },
];

/** Index of the step in progress (STEPS.length once all are done). */
function deriveStepIndex(lines: string[]): number {
    let idx = 0;
    for (const line of lines) {
        if (/Stashing local changes/i.test(line)) idx = Math.max(idx, 1);
        if (/Fetching remote\.\.\. ok/i.test(line)) idx = Math.max(idx, 2);
        if (/Fast-forwarding .*\.\.\. ok/i.test(line)) idx = Math.max(idx, 3);
    }
    return idx;
}

function ProjectChip({
    project,
    repo,
    displayId,
}: {
    project: IProject;
    repo: IProjectRepo;
    displayId: string;
}) {
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
                    <Box sx={{ fontFamily: MONO, fontSize: 11, color: ATLAS_PALETTE.slate70 }}>
                        {repo.name}
                    </Box>
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
                <Typography
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
                    {repo.git_url ? `${repo.git_url} · ${repo.git_path}` : repo.git_path}
                </Typography>
            </Box>
        </Box>
    );
}

const KV_ROW_SX = {
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    px: 3,
    py: 2,
};

export function RecloneProjectModal({ open, project, repo, displayId, onClose }: Props) {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [view, setView] = useState<View>('confirm');
    const [recloneId, setRecloneId] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState<number>(0);
    const terminalRef = useRef<HTMLDivElement | null>(null);

    const job = useRecloneJob(recloneId);

    const statusQuery = useQuery({
        // ADR 0018 — one status per repo, so the repo id is part of the key.
        queryKey: ['project-status', project?.id, repo?.id],
        // `enabled` gates on both ids being present.
        queryFn: () => api.projects.status(project!.id, repo!.id),
        enabled: open && view === 'confirm' && Boolean(project && repo),
        staleTime: 0,
    });

    useEffect(() => {
        if (!open) {
            setView('confirm');
            setRecloneId(null);
            setSubmitError(null);
            setStartedAt(null);
            setElapsedMs(0);
        }
    }, [open]);

    useEffect(() => {
        if (job.status === 'ready') {
            setView('success');
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['project-status', project?.id, repo?.id] });
        } else if (job.status === 'error') {
            setView('error');
        }
    }, [job.status, qc, project?.id, repo?.id]);

    useEffect(() => {
        if (view !== 'running' || !startedAt) return;
        const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
        return () => clearInterval(id);
    }, [view, startedAt]);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [job.lines.length]);

    const stepIndex = useMemo(() => deriveStepIndex(job.lines), [job.lines]);

    // git's own diffstat on a fast-forward (" 3 files changed, …"); the
    // commit count comes from the runner, which compares HEAD before/after.
    const filesChanged = useMemo(() => {
        let files = 0;
        for (const line of job.lines) {
            const f = line.match(/(\d+)\s+files?\s+changed/i);
            if (f) files = Number(f[1]);
        }
        return files;
    }, [job.lines]);
    const activeStep = STEPS[Math.min(stepIndex, STEPS.length - 1)];

    function handleClose() {
        if (view === 'running') return;
        onClose();
    }

    async function startReclone() {
        if (!project || !repo) return;
        setSubmitError(null);
        // Subscribe (via useRecloneJob) before the POST — see newJobId.
        const id = newJobId();
        setRecloneId(id);
        setStartedAt(Date.now());
        setElapsedMs(0);
        setView('running');
        try {
            await api.projects.reclone(project.id, repo.id, id);
        } catch (e) {
            setRecloneId(null);
            setView('confirm');
            setSubmitError(e instanceof Error ? e.message : 'Could not start the pull');
        }
    }

    function openProject() {
        if (!project) return;
        onClose();
        navigate(`/projects/${project.id}`);
    }

    if (!project || !repo) return null;

    const statusData = statusQuery.data;
    const uncommitted = statusData?.uncommitted ?? 0;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            disableEscapeKeyDown={view === 'running'}
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
                                  : ATLAS_PALETTE.cloud,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {view === 'success' ? (
                        <CheckCircleOutline sx={{ color: ATLAS_PALETTE.green, fontSize: 22 }} />
                    ) : view === 'error' ? (
                        <ErrorOutline sx={{ color: ATLAS_PALETTE.error, fontSize: 22 }} />
                    ) : (
                        <RefreshRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />
                    )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>
                        {view === 'confirm' && 'Pull from remote?'}
                        {view === 'running' && 'Pulling from remote…'}
                        {view === 'success' && 'Pulled from remote'}
                        {view === 'error' && 'Pull failed'}
                    </FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {view === 'confirm' &&
                            'Stash local changes, fetch from remote, and fast-forward.'}
                        {view === 'running' && 'Running git in the background.'}
                        {view === 'success' && 'Workspace is now in sync with the remote.'}
                        {view === 'error' && 'A git command failed.'}
                    </Typography>
                </Box>
                {view !== 'running' && (
                    <IconButton onClick={handleClose} size="small">
                        <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                    </IconButton>
                )}
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                <ProjectChip project={project} repo={repo} displayId={displayId} />

                {view === 'confirm' && (
                    <>
                        {statusQuery.isPending ? (
                            <Box
                                sx={{
                                    mt: 4,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    py: 6,
                                }}
                            >
                                <CircularProgress
                                    size={24}
                                    sx={{ color: ATLAS_PALETTE.brandBlue }}
                                />
                            </Box>
                        ) : statusQuery.isError ? (
                            <Alert
                                severity="error"
                                sx={{
                                    mt: 4,
                                    fontSize: 12,
                                    '& .MuiAlert-message': { fontSize: 12 },
                                }}
                            >
                                Could not read git status. Is the workspace folder still on disk?
                            </Alert>
                        ) : (
                            <>
                                <Box
                                    sx={{
                                        mt: 4,
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '10px',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {[
                                        ['Local HEAD', statusData?.local_head ?? '—', false],
                                        ['Remote HEAD', statusData?.remote_head ?? '—', false],
                                        ['Behind', `${statusData?.behind ?? 0} commits`, false],
                                        [
                                            'Uncommitted',
                                            uncommitted > 0
                                                ? `${uncommitted} modified files`
                                                : 'clean',
                                            uncommitted > 0,
                                        ],
                                    ].map(([k, v, dirty], i) => (
                                        <Box
                                            key={k as string}
                                            sx={{
                                                ...KV_ROW_SX,
                                                borderBottom:
                                                    i < 3
                                                        ? `1px solid ${ATLAS_PALETTE.slate06}`
                                                        : 'none',
                                                bgcolor:
                                                    i % 2 === 0
                                                        ? ATLAS_PALETTE.white
                                                        : ATLAS_PALETTE.slate08,
                                            }}
                                        >
                                            <Typography
                                                sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}
                                            >
                                                {k as string}
                                            </Typography>
                                            <Typography
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 12,
                                                    color: dirty
                                                        ? ATLAS_PALETTE.error
                                                        : ATLAS_PALETTE.slate,
                                                    fontWeight: dirty ? 600 : 400,
                                                }}
                                            >
                                                {v as string}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Box>

                                {uncommitted > 0 && (
                                    <Alert
                                        icon={<WarningAmberRounded sx={{ color: '#C7532F' }} />}
                                        sx={{
                                            mt: 3,
                                            bgcolor: 'rgba(199,83,47,.06)',
                                            border: `1px solid rgba(199,83,47,.18)`,
                                            color: ATLAS_PALETTE.slate,
                                            '& .MuiAlert-message': { fontSize: 12 },
                                        }}
                                    >
                                        <Box component="span" sx={{ fontWeight: 600 }}>
                                            {uncommitted} uncommitted files
                                        </Box>{' '}
                                        will be stashed to{' '}
                                        <Box component="span" sx={{ fontFamily: MONO }}>
                                            .git/atlas-stash/
                                        </Box>{' '}
                                        before pulling. Restore them afterwards with{' '}
                                        <Box component="span" sx={{ fontFamily: MONO }}>
                                            git stash pop
                                        </Box>
                                        .
                                    </Alert>
                                )}
                            </>
                        )}

                        {submitError &&
                        submitError.startsWith('Original credential was deleted') ? (
                            <Alert
                                severity="error"
                                icon={<WarningAmberRounded sx={{ color: ATLAS_PALETTE.error }} />}
                                sx={{
                                    mt: 3,
                                    bgcolor: 'rgba(220,38,38,.06)',
                                    border: `1px solid rgba(220,38,38,.18)`,
                                    color: ATLAS_PALETTE.slate,
                                    '& .MuiAlert-message': { fontSize: 13 },
                                }}
                            >
                                <strong>Original credential was deleted</strong>
                                <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                    Re-attach a credential in Settings → Credentials before
                                    pulling.
                                </Box>
                            </Alert>
                        ) : submitError ? (
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
                        ) : null}

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Cancel
                            </Button>
                            {submitError &&
                            submitError.startsWith('Original credential was deleted') ? (
                                <Button
                                    variant="contained"
                                    onClick={() => {
                                        onClose();
                                        navigate('/settings/credentials');
                                    }}
                                    sx={{
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        bgcolor: ATLAS_PALETTE.brandBlue,
                                        '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue },
                                    }}
                                >
                                    Manage credentials →
                                </Button>
                            ) : (
                                <Button
                                    variant="contained"
                                    color="success"
                                    disabled={statusQuery.isPending || statusQuery.isError}
                                    onClick={() => void startReclone()}
                                    startIcon={<RefreshRounded />}
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    {uncommitted > 0 ? 'Stash & pull' : 'Pull'}
                                </Button>
                            )}
                        </Box>
                    </>
                )}

                {view === 'running' && (
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
                                    Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length}{' '}
                                    · {activeStep?.label}
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
                                value={(stepIndex / STEPS.length) * 100}
                                sx={{
                                    height: 6,
                                    borderRadius: 3,
                                    bgcolor: ATLAS_PALETTE.slate08,
                                    '& .MuiLinearProgress-bar': {
                                        bgcolor: ATLAS_PALETTE.brandBlue,
                                    },
                                }}
                            />
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4 }}>
                            {STEPS.map((s, i) => {
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
                                            border: `1px solid ${active ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                                            bgcolor: active ? 'rgba(0,122,201,.04)' : 'transparent',
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
                                                sx={{ color: ATLAS_PALETTE.brandBlue }}
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
                            git · live output
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
                                Closing disabled — pull in progress
                            </Typography>
                            <Button
                                variant="contained"
                                disabled
                                startIcon={<CircularProgress size={14} color="inherit" />}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Pulling…
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
                            <strong>
                                {job.commitsPulled === null
                                    ? 'Pull complete'
                                    : job.commitsPulled > 0
                                      ? `Fast-forwarded ${job.commitsPulled} commit${job.commitsPulled === 1 ? '' : 's'}`
                                      : 'Already up to date'}
                                {filesChanged > 0 &&
                                    ` · ${filesChanged} file${filesChanged === 1 ? '' : 's'} changed`}
                                {` · ${Math.max(1, Math.round(elapsedMs / 1000))}s`}
                            </strong>
                            {job.stashPath && (
                                <Box
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate70,
                                        mt: 0.5,
                                    }}
                                >
                                    Your stashed files are kept in {job.stashPath}
                                </Box>
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
                            git · transcript
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
                                variant="contained"
                                color="success"
                                endIcon={<ArrowForward />}
                                onClick={() => void openProject()}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Open project
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
                            <strong>{activeStep?.label} failed</strong>
                            <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                Possible cause: diverged history, missing branch, or auth failure.
                                See stderr below.
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
                            git · stderr
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

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={onClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Close
                            </Button>
                            <Button
                                variant="contained"
                                onClick={() => {
                                    setRecloneId(null);
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
