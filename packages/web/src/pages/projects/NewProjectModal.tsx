import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import ArrowForward from '@mui/icons-material/ArrowForward';
import GitHubIcon from '@mui/icons-material/GitHub';
import CloudDownloadRounded from '@mui/icons-material/CloudDownloadRounded';
import { useQueryClient } from '@tanstack/react-query';
import { useCredentials } from '../../hooks/useCredentials.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useAgents } from '../../hooks/useAgents.js';
import { useCloneJob } from '../../hooks/useCloneJob.js';
import { api } from '../../api/api.js';
import type { ConnectError } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FolderPicker } from '../../components/FolderPicker.js';
import { FormHeading } from '../../components/FormHeading.js';
import {
    ConnectErrorDetails,
    CredentialSelect,
    HINT_SX,
    LABEL_SX,
    inputSx,
} from './RepoFormParts.js';

const MONO = '"JetBrains Mono", monospace';
const REPO_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

type View = 'form' | 'cloning' | 'success' | 'error' | 'connect_error';
type CreateMode = 'clone' | 'connect';

interface Props {
    open: boolean;
    onClose: () => void;
}

interface ChecklistStep {
    key: string;
    label: string;
}

const STEPS: ChecklistStep[] = [
    { key: 'resolve', label: 'Resolve credential' },
    { key: 'verify', label: 'Verify remote' },
    { key: 'clone', label: 'Clone repository' },
    { key: 'register', label: 'Register with Atlas' },
    { key: 'index', label: 'Index initial commit' },
];

function deriveStepIndex(lines: string[]): number {
    let idx = 1; // resolve always done once we start
    for (const line of lines) {
        if (/Cloning into/i.test(line) || /git clone/i.test(line)) idx = Math.max(idx, 2);
        if (/Receiving objects/i.test(line) || /Resolving deltas/i.test(line))
            idx = Math.max(idx, 2);
        if (/exited with code 0/i.test(line)) idx = Math.max(idx, 4);
    }
    return idx;
}

function findLast(lines: string[], pred: (l: string) => boolean): string | null {
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line !== undefined && pred(line)) return line;
    }
    return null;
}

function extractStats(lines: string[]): { objects: string | null; size: string | null } {
    const objMatch = findLast(lines, (l) => /Receiving objects:\s*100%/i.test(l));
    const sizeMatch = findLast(lines, (l) => /KiB|MiB|GiB/.test(l));
    let objects: string | null = null;
    let size: string | null = null;
    if (objMatch) {
        const m = objMatch.match(/\((\d+)\/\d+\)/);
        if (m) objects = m[1] ?? null;
    }
    if (sizeMatch) {
        const m = sizeMatch.match(/(\d+(?:\.\d+)?\s*(?:KiB|MiB|GiB))/);
        if (m) size = m[1] ?? null;
    }
    return { objects, size };
}

// Pull the current git sub-stage from the most recent progress line. Used to
// surface "RECEIVING OBJECTS" / "RESOLVING DELTAS" / etc. instead of the
// high-level "CLONE REPOSITORY" header during the clone step.
const PHASE_RE =
    /(Counting objects|Receiving objects|Resolving deltas|Indexing objects|Updating files|Compressing objects):\s*(\d+)%/i;
function deriveLivePhase(lines: string[]): {
    phase: string | null;
    percent: number | null;
    bytes: string | null;
} {
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line) continue;
        const m = PHASE_RE.exec(line);
        if (!m || !m[1]) continue;
        const phase = m[1].toUpperCase();
        const percent = Number(m[2]);
        const bytesMatch = line.match(/(\d+(?:\.\d+)?\s*(?:KiB|MiB|GiB))/);
        return {
            phase,
            percent: Number.isFinite(percent) ? percent : null,
            bytes: bytesMatch?.[1] ?? null,
        };
    }
    return { phase: null, percent: null, bytes: null };
}

function deriveErrorHeadline(detail: string): { headline: string; suggestion: string } {
    if (/Authentication failed/i.test(detail)) {
        return {
            headline: 'Authentication failed (exit 128)',
            suggestion:
                "The selected credential couldn't access this repo. Check the token's scope, the repo URL, or pick a different credential.",
        };
    }
    if (/Repository not found/i.test(detail)) {
        return {
            headline: 'Repository not found',
            suggestion:
                'The repo URL may be private, mistyped, or your token lacks access. Double-check the URL.',
        };
    }
    if (/not.*empty/i.test(detail) && /destination/i.test(detail)) {
        return {
            headline: 'Destination already exists',
            suggestion:
                'Pick a different project name or remove the existing folder in your workspace.',
        };
    }
    return {
        headline: 'Clone failed',
        suggestion:
            'The PowerShell script returned a non-zero exit code. Inspect the stderr below.',
    };
}

export function NewProjectModal({ open, onClose }: Props) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { data: credentials = [] } = useCredentials();
    const { data: settings } = useSettings();
    const [view, setView] = useState<View>('form');
    const { data: agents } = useAgents({ enabled: view === 'success' });
    const [createMode, setCreateMode] = useState<CreateMode>('clone');
    const [repoUrl, setRepoUrl] = useState('');
    const [credentialId, setCredentialId] = useState<string>('');
    const [projectName, setProjectName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [issueKeyPrefix, setIssueKeyPrefix] = useState('');
    const [prefixStatus, setPrefixStatus] = useState<
        | { kind: 'idle' }
        | { kind: 'invalid' }
        | { kind: 'checking' }
        | { kind: 'ok' }
        | { kind: 'collision'; reason: 'in_use'; conflict: string | null }
    >({ kind: 'idle' });
    const [defaultBranch, setDefaultBranch] = useState('main');
    const [cloneId, setCloneId] = useState<string | null>(null);
    const [destination, setDestination] = useState('');
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [elapsedMs, setElapsedMs] = useState<number>(0);
    const [existingFolder, setExistingFolder] = useState<string>('');
    const [verifying, setVerifying] = useState<boolean>(false);
    const [verifyError, setVerifyError] = useState<ConnectError | null>(null);
    const terminalRef = useRef<HTMLDivElement | null>(null);

    const job = useCloneJob(cloneId);

    // Reset when modal is closed (or when reopening from idle).
    useEffect(() => {
        if (!open) {
            setView('form');
            setCreateMode('clone');
            setRepoUrl('');
            setCredentialId('');
            setProjectName('');
            setNameTouched(false);
            setIssueKeyPrefix('');
            setPrefixStatus({ kind: 'idle' });
            setDefaultBranch('main');
            setCloneId(null);
            setDestination('');
            setSubmitError(null);
            setStartedAt(null);
            setElapsedMs(0);
            setExistingFolder('');
            setVerifying(false);
            setVerifyError(null);
        }
    }, [open]);

    // Debounced prefix-availability probe. Only fires once the value is the
    // canonical 3-uppercase-letter shape. Anything shorter or non-alpha gets
    // marked invalid locally without hitting the server.
    useEffect(() => {
        if (!open) return;
        if (issueKeyPrefix.length === 0) {
            setPrefixStatus({ kind: 'idle' });
            return;
        }
        if (!/^[A-Z]{3}$/.test(issueKeyPrefix)) {
            setPrefixStatus({ kind: 'invalid' });
            return;
        }
        setPrefixStatus({ kind: 'checking' });
        const handle = window.setTimeout(() => {
            void api.projects
                .prefixAvailable(issueKeyPrefix)
                .then((r) => {
                    if (r.available) {
                        setPrefixStatus({ kind: 'ok' });
                    } else if (r.reason === 'in_use') {
                        setPrefixStatus({
                            kind: 'collision',
                            reason: r.reason,
                            conflict: r.conflict ?? null,
                        });
                    } else {
                        setPrefixStatus({ kind: 'invalid' });
                    }
                })
                .catch(() => {
                    // Network error — leave as checking; user can retry.
                });
        }, 350);
        return () => window.clearTimeout(handle);
    }, [issueKeyPrefix, open]);

    // Follow the URL until the Owner types their own name — a name-empty guard
    // froze on the first partial match ("a" from github.com/owner/a…).
    useEffect(() => {
        const m = repoUrl.match(REPO_RE);
        if (m && !nameTouched) {
            setProjectName(m[2] ?? '');
        }
    }, [repoUrl, nameTouched]);

    // Auto-select first credential.
    useEffect(() => {
        if (!credentialId && credentials.length > 0) {
            setCredentialId(credentials[0]!.id);
        }
    }, [credentials, credentialId]);

    // Drive view transitions from useCloneJob.
    useEffect(() => {
        if (job.status === 'ready') {
            setView('success');
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({ queryKey: ['repos'] });
        } else if (job.status === 'error') {
            setView('error');
        }
    }, [job.status, qc]);

    // Tick elapsed timer during cloning.
    useEffect(() => {
        if (view !== 'cloning' || !startedAt) return;
        const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
        return () => clearInterval(id);
    }, [view, startedAt]);

    const [headInfo, setHeadInfo] = useState<{
        short_sha: string | null;
        subject: string | null;
        relative_time: string | null;
    } | null>(null);
    // ADR 0018 — HEAD belongs to the repo the clone created, not the project.
    useEffect(() => {
        const project = job.project;
        const repo = job.repo;
        if (!project || !repo) return;
        void api.projects
            .head(project.id, repo.id)
            .then((r) => setHeadInfo(r))
            .catch(() => setHeadInfo(null));
    }, [job.project, job.repo]);

    // Auto-scroll terminal.
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [job.lines.length]);

    const workspacePath = settings?.workspace_path ?? '';
    const computedDest = useMemo(() => {
        if (!workspacePath) return '';
        const sep = workspacePath.includes('\\') ? '\\' : '/';
        // Until the name resolves from the URL, show the workspace root with a
        // neutral tail rather than claiming the workspace path is unset.
        return `${workspacePath.replace(/[\\/]$/, '')}${sep}${projectName.trim() || '…'}`;
    }, [workspacePath, projectName]);

    const repoIsValid = REPO_RE.test(repoUrl.trim());
    const prefixIsOk = prefixStatus.kind === 'ok';
    const canSubmit =
        repoIsValid &&
        credentialId &&
        projectName.trim().length > 0 &&
        defaultBranch.trim().length > 0 &&
        prefixIsOk;

    const selectedCred = useMemo(
        () => credentials.find((c) => c.id === credentialId) ?? null,
        [credentials, credentialId]
    );

    const stepIndex = useMemo(() => deriveStepIndex(job.lines), [job.lines]);
    const stats = useMemo(() => extractStats(job.lines), [job.lines]);
    const livePhase = useMemo(() => deriveLivePhase(job.lines), [job.lines]);
    const err = useMemo(() => deriveErrorHeadline(job.errorDetail ?? ''), [job.errorDetail]);

    function handleClose() {
        if (view === 'cloning') return; // locked
        onClose();
    }

    async function startClone() {
        setSubmitError(null);
        try {
            const res = await api.projects.clone({
                repo_url: repoUrl.trim(),
                credential_id: credentialId,
                project_name: projectName.trim(),
                issue_key_prefix: issueKeyPrefix,
                default_branch: defaultBranch.trim(),
            });
            setCloneId(res.clone_id);
            setDestination(res.destination);
            setStartedAt(Date.now());
            setElapsedMs(0);
            setView('cloning');
        } catch (e) {
            // Server-side 409 race (another tab claimed the prefix between our
            // probe and submit) is the same UX as the inline collision banner.
            const msg = e instanceof Error ? e.message : 'Could not start clone';
            if (/prefix/i.test(msg)) {
                setPrefixStatus({ kind: 'collision', reason: 'in_use', conflict: null });
            }
            setSubmitError(msg);
        }
    }

    function handleRetry() {
        setCloneId(null);
        setSubmitError(null);
        void startClone();
    }

    function handleExistingFolderChange(next: string) {
        setExistingFolder(next);
        // When the user lands on a folder via the picker (or finishes typing one),
        // try to read its git origin and auto-fill the URL. Best-effort: a missing
        // folder, no .git, or any error is silent — the user can type the URL.
        const trimmed = next.trim();
        if (!trimmed) return;
        void api.projects
            .folderOrigin(trimmed)
            .then(({ origin }) => {
                if (origin) setRepoUrl(origin);
            })
            .catch(() => {});
    }

    async function startConnect() {
        setSubmitError(null);
        setVerifyError(null);
        setVerifying(true);
        try {
            const res = await api.projects.connect({
                folder_path: existingFolder,
                repo_url: repoUrl.trim(),
                credential_id: credentialId,
                issue_key_prefix: issueKeyPrefix,
            });
            if (res.ok) {
                // ADR 0018 — connect answers with { project, repo }; the
                // projects list reads every repo from ['repos'].
                void qc.invalidateQueries({ queryKey: ['projects'] });
                void qc.invalidateQueries({ queryKey: ['repos'] });
                void qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
                onClose();
            } else {
                const raw = res.body as unknown as {
                    error_kind?: string;
                    reason?: 'in_use';
                    conflict?: string | null;
                };
                if (raw.error_kind === 'prefix_collision' && raw.reason === 'in_use') {
                    setPrefixStatus({
                        kind: 'collision',
                        reason: raw.reason,
                        conflict: raw.conflict ?? null,
                    });
                } else {
                    setVerifyError(res.body as ConnectError);
                    setView('connect_error');
                }
            }
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not connect');
        } finally {
            setVerifying(false);
        }
    }

    function copyStderr() {
        if (job.errorDetail) void navigator.clipboard.writeText(job.errorDetail).catch(() => {});
    }

    function openProject() {
        if (!job.project) return;
        onClose();
        navigate(`/projects/${job.project.id}`);
    }

    function addAnother() {
        setCloneId(null);
        setRepoUrl('');
        setProjectName('');
        setNameTouched(false);
        setIssueKeyPrefix('');
        setPrefixStatus({ kind: 'idle' });
        setDefaultBranch('main');
        setStartedAt(null);
        setElapsedMs(0);
        setView('form');
    }

    const canConnect =
        existingFolder.trim().length > 0 && repoIsValid && credentialId && !verifying && prefixIsOk;

    function renderPrefixField() {
        let helperText =
            'Issue ids in this project become {PREFIX}-1, {PREFIX}-2, … and the prefix can’t be changed later.';
        let isError = false;
        if (issueKeyPrefix.length > 0 && issueKeyPrefix.length < 3) {
            helperText = 'Exactly 3 uppercase letters.';
        } else if (prefixStatus.kind === 'invalid') {
            helperText = 'Exactly 3 uppercase letters (A–Z), no digits or symbols.';
            isError = true;
        } else if (prefixStatus.kind === 'checking') {
            helperText = 'Checking availability…';
        } else if (prefixStatus.kind === 'collision') {
            isError = true;
            helperText = `Already used by "${prefixStatus.conflict ?? 'another project'}"`;
        } else if (prefixStatus.kind === 'ok') {
            helperText =
                'Available. New issues will be ' +
                issueKeyPrefix +
                '-1, ' +
                issueKeyPrefix +
                '-2, …';
        }
        return (
            <TextField
                fullWidth
                size="small"
                required
                label="Issue key prefix"
                value={issueKeyPrefix}
                onChange={(e) =>
                    setIssueKeyPrefix(
                        e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z]/g, '')
                            .slice(0, 3)
                    )
                }
                placeholder="ATL"
                slotProps={{
                    htmlInput: {
                        maxLength: 3,
                        style: { fontFamily: MONO, letterSpacing: '0.08em' },
                    },
                }}
                error={isError}
                helperText={helperText}
                FormHelperTextProps={
                    prefixStatus.kind === 'ok' ? { sx: { color: ATLAS_PALETTE.green } } : undefined
                }
            />
        );
    }

    function manageCredentials() {
        onClose();
        navigate('/settings/credentials');
    }

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            disableEscapeKeyDown={view === 'cloning'}
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    // Constrain to viewport with margins on mobile so the
                    // dialog doesn't render edge-to-edge (the previous
                    // fullScreen={isMobile} behavior produced a cramped,
                    // unstyled-looking sheet on phones).
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            {/* Header */}
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
                    ) : view === 'error' || view === 'connect_error' ? (
                        <ErrorOutline sx={{ color: ATLAS_PALETTE.error, fontSize: 22 }} />
                    ) : view === 'cloning' ? (
                        <CloudDownloadOutlined
                            sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }}
                        />
                    ) : createMode === 'connect' ? (
                        <FolderOutlined sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />
                    ) : (
                        <AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />
                    )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>
                        {view === 'form' &&
                            (createMode === 'clone' ? 'New project' : 'Connect existing folder')}
                        {view === 'cloning' && 'Cloning repository…'}
                        {view === 'success' && 'Project ready'}
                        {view === 'error' && 'Clone failed'}
                        {view === 'connect_error' &&
                            (verifyError?.error_kind === 'already_registered'
                                ? 'Folder already registered'
                                : verifyError?.error_kind === 'auth_failed'
                                  ? 'Authentication failed'
                                  : verifyError?.error_kind === 'not_git'
                                    ? 'Folder is not a git repository'
                                    : verifyError?.error_kind === 'missing_folder'
                                      ? 'Folder not found'
                                      : "Folder doesn't match repository")}
                    </FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {view === 'form' &&
                            (createMode === 'clone'
                                ? "Paste a git URL — we'll clone it into your workspace."
                                : "Point at a folder you already have — we'll verify the remote and register it.")}
                        {view === 'cloning' &&
                            'Running clone-repo.ps1 in the background. Please keep this window open.'}
                        {view === 'success' && 'Cloned, indexed, and registered with Atlas.'}
                        {view === 'error' && 'The PowerShell script returned a non-zero exit code.'}
                        {view === 'connect_error' &&
                            (verifyError?.error_kind === 'origin_mismatch'
                                ? 'The remote configured in this folder doesn’t match the URL you entered.'
                                : 'Resolve the issue below and re-verify.')}
                    </Typography>
                </Box>
                {view !== 'cloning' && (
                    <IconButton onClick={handleClose} size="small">
                        <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                    </IconButton>
                )}
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                {view === 'form' && (
                    <>
                        {/* Mode toggle */}
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 1,
                                mb: 4,
                                p: 0.5,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '10px',
                                bgcolor: ATLAS_PALETTE.white,
                            }}
                        >
                            <Box
                                onClick={() => setCreateMode('clone')}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    px: 2.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    bgcolor:
                                        createMode === 'clone'
                                            ? ATLAS_PALETTE.cloud
                                            : 'transparent',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    transition: 'background 150ms ease',
                                }}
                            >
                                <CloudDownloadRounded
                                    sx={{
                                        fontSize: 18,
                                        color:
                                            createMode === 'clone'
                                                ? ATLAS_PALETTE.brandBlue
                                                : ATLAS_PALETTE.slate60,
                                    }}
                                />
                                <Box>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        Clone fresh
                                    </Typography>
                                    <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                        new local folder
                                    </Typography>
                                </Box>
                            </Box>
                            <Box
                                onClick={() => setCreateMode('connect')}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    px: 2.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    bgcolor:
                                        createMode === 'connect'
                                            ? ATLAS_PALETTE.cloud
                                            : 'transparent',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    transition: 'background 150ms ease',
                                }}
                            >
                                <FolderOutlined
                                    sx={{
                                        fontSize: 18,
                                        color:
                                            createMode === 'connect'
                                                ? ATLAS_PALETTE.brandBlue
                                                : ATLAS_PALETTE.slate60,
                                    }}
                                />
                                <Box>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        Use existing folder
                                    </Typography>
                                    <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                        already on disk
                                    </Typography>
                                </Box>
                            </Box>
                        </Box>

                        {createMode === 'clone' ? (
                            <>
                                <TextField
                                    fullWidth
                                    size="small"
                                    required
                                    label="Repository URL"
                                    value={repoUrl}
                                    onChange={(e) => setRepoUrl(e.target.value)}
                                    placeholder="https://github.com/acme/orion-pricing.git"
                                    helperText="HTTPS · github.com only."
                                    sx={{ mb: 3 }}
                                />

                                <CredentialSelect
                                    credentials={credentials}
                                    value={credentialId}
                                    onChange={setCredentialId}
                                    onManage={manageCredentials}
                                />

                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                        gap: 3,
                                        mb: 3,
                                    }}
                                >
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Project name"
                                        value={projectName}
                                        onChange={(e) => {
                                            setProjectName(e.target.value);
                                            setNameTouched(e.target.value.trim() !== '');
                                        }}
                                        placeholder="orion-pricing"
                                        helperText="Auto-filled from the URL."
                                    />
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Default branch"
                                        value={defaultBranch}
                                        onChange={(e) => setDefaultBranch(e.target.value)}
                                        placeholder="main"
                                    />
                                </Box>

                                <Box sx={{ mb: 3 }}>{renderPrefixField()}</Box>

                                <Typography sx={LABEL_SX}>
                                    Clone destination
                                    <Box component="span" sx={HINT_SX}>
                                        from Settings · Workspace
                                    </Box>
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        px: 3,
                                        py: 2.5,
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '6px',
                                        bgcolor: ATLAS_PALETTE.slate08,
                                        mb: 3,
                                    }}
                                >
                                    <Box
                                        sx={{
                                            px: 1.5,
                                            py: 0.25,
                                            bgcolor: ATLAS_PALETTE.white,
                                            borderRadius: '4px',
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate70,
                                        }}
                                    >
                                        folder
                                    </Box>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 13,
                                            color: ATLAS_PALETTE.slate70,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            flex: 1,
                                        }}
                                    >
                                        {computedDest ||
                                            (settings
                                                ? 'Set a workspace path in Settings first'
                                                : '…')}
                                    </Typography>
                                </Box>

                                <Alert
                                    icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                    sx={{
                                        bgcolor: ATLAS_PALETTE.cloud,
                                        color: ATLAS_PALETTE.slate,
                                        '& .MuiAlert-message': { fontSize: 12 },
                                    }}
                                >
                                    Credentials are decrypted in-memory only for the duration of the
                                    clone and zeroed afterwards. The script runs as a background job
                                    — you&apos;ll see live output here.
                                </Alert>
                            </>
                        ) : (
                            <>
                                <Typography sx={LABEL_SX}>
                                    Existing folder
                                    <Box component="span" sx={HINT_SX}>
                                        must contain a .git directory
                                    </Box>
                                </Typography>
                                <Box sx={{ mb: 3 }}>
                                    <FolderPicker
                                        ariaLabel="Existing folder"
                                        value={existingFolder}
                                        onChange={handleExistingFolderChange}
                                        placeholder="C:\Users\…\projects\my-repo"
                                        size="small"
                                        textFieldSx={inputSx}
                                    />
                                </Box>

                                <TextField
                                    fullWidth
                                    size="small"
                                    required
                                    label="Repository URL"
                                    value={repoUrl}
                                    onChange={(e) => setRepoUrl(e.target.value)}
                                    placeholder="https://github.com/acme/orion-pricing.git"
                                    helperText="We verify this matches the folder's remote."
                                    sx={{ mb: 3 }}
                                />

                                <Box sx={{ mb: 3 }}>{renderPrefixField()}</Box>

                                <CredentialSelect
                                    credentials={credentials}
                                    value={credentialId}
                                    onChange={setCredentialId}
                                    onManage={manageCredentials}
                                />

                                <Box
                                    sx={{
                                        p: 3,
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '10px',
                                        bgcolor: ATLAS_PALETTE.slate08,
                                        mb: 3,
                                    }}
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
                                        We&apos;ll verify before registering
                                    </Typography>
                                    {[
                                        'Folder exists and contains a .git directory',
                                        'Remote origin matches the URL above',
                                        'Credential can reach the remote (git ls-remote)',
                                        'No conflicts with already-registered projects',
                                    ].map((t) => (
                                        <Box
                                            key={t}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.5,
                                                py: 0.5,
                                            }}
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

                                <Alert
                                    icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                    sx={{
                                        bgcolor: ATLAS_PALETTE.cloud,
                                        color: ATLAS_PALETTE.slate,
                                        '& .MuiAlert-message': { fontSize: 12 },
                                    }}
                                >
                                    Your local files are never touched. We only read{' '}
                                    <Box component="span" sx={{ fontFamily: MONO }}>
                                        git config
                                    </Box>{' '}
                                    and run an authenticated{' '}
                                    <Box component="span" sx={{ fontFamily: MONO }}>
                                        ls-remote
                                    </Box>{' '}
                                    to confirm access.
                                </Alert>
                            </>
                        )}

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
                            {createMode === 'clone' ? (
                                <Button
                                    variant="contained"
                                    color="success"
                                    onClick={() => void startClone()}
                                    disabled={!canSubmit}
                                    endIcon={<ArrowForward />}
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    Clone Repository
                                </Button>
                            ) : (
                                <Button
                                    variant="contained"
                                    color="success"
                                    onClick={() => void startConnect()}
                                    disabled={!canConnect}
                                    startIcon={
                                        verifying ? (
                                            <CircularProgress size={14} color="inherit" />
                                        ) : undefined
                                    }
                                    endIcon={!verifying ? <ArrowForward /> : undefined}
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    {verifying ? 'Verifying…' : 'Connect Repository'}
                                </Button>
                            )}
                        </Box>
                    </>
                )}

                {view === 'cloning' && (
                    <>
                        {/* Repo URL card */}
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 3,
                                p: 3,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '10px',
                                mb: 3,
                            }}
                        >
                            <GitHubIcon
                                sx={{ fontSize: 16, color: ATLAS_PALETTE.slate70, mt: '2px' }}
                            />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        color: ATLAS_PALETTE.slate,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {repoUrl}
                                </Typography>
                                <Typography
                                    sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                                >
                                    using GitHub · {selectedCred?.label ?? '—'} · →{' '}
                                    <Box component="span" sx={{ fontFamily: MONO }}>
                                        {destination}
                                    </Box>
                                </Typography>
                            </Box>
                        </Box>

                        {/* Progress strip */}
                        <Box sx={{ mb: 4 }}>
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
                                    Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length} ·{' '}
                                    {stepIndex === 2 && livePhase.phase
                                        ? livePhase.phase
                                        : (
                                              STEPS[Math.min(stepIndex, STEPS.length - 1)]?.label ??
                                              'Working'
                                          ).toUpperCase()}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {livePhase.percent !== null
                                        ? `${livePhase.percent}%${livePhase.bytes ? ` · ${livePhase.bytes}` : ''}`
                                        : ''}
                                </Typography>
                            </Box>
                            <LinearProgress
                                {...(livePhase.percent !== null
                                    ? { variant: 'determinate' as const, value: livePhase.percent }
                                    : {})}
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

                        {/* Step checklist */}
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
                                                color: done
                                                    ? ATLAS_PALETTE.slate
                                                    : active
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

                        {/* Live output terminal */}
                        <Box sx={{ mb: 1 }}>
                            <Typography
                                sx={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                clone-repo.ps1 · live output
                            </Typography>
                        </Box>
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

                        {/* Footer */}
                        <Box
                            sx={{
                                mt: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                Closing disabled — clone in progress
                            </Typography>
                            <Button
                                variant="contained"
                                disabled
                                startIcon={<CircularProgress size={14} color="inherit" />}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Cloning…
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'success' && job.project && (
                    <>
                        <Alert
                            icon={<CheckCircleOutline sx={{ color: ATLAS_PALETTE.green }} />}
                            sx={{
                                bgcolor: 'rgba(49,171,70,.08)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            <strong>
                                Cloned in {Math.max(1, Math.round(elapsedMs / 1000))}s
                                {stats.objects && ` · ${stats.objects} objects`}
                                {stats.size && ` · ${stats.size}`}
                            </strong>
                            <Box
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.slate70,
                                    mt: 0.5,
                                }}
                            >
                                {job.repo?.git_path ?? '—'}
                            </Box>
                        </Alert>

                        <Box
                            sx={{
                                mt: 4,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '10px',
                                overflow: 'hidden',
                            }}
                        >
                            {(
                                [
                                    ['Project ID', job.project.id.slice(0, 8)],
                                    ['Default branch', job.repo?.default_branch ?? '—'],
                                    [
                                        'Latest commit',
                                        headInfo && headInfo.short_sha
                                            ? `${headInfo.short_sha} · ${headInfo.subject ?? '—'}${headInfo.relative_time ? ` (${headInfo.relative_time})` : ''}`
                                            : '—',
                                    ],
                                    [
                                        'Agents',
                                        // Agents are global — every installed agent can work this project.
                                        agents === undefined ? (
                                            '—'
                                        ) : agents.length > 0 ? (
                                            `${agents.length} installed · shared by all projects`
                                        ) : (
                                            <Button
                                                size="small"
                                                onClick={() => {
                                                    onClose();
                                                    navigate('/agents/marketplace');
                                                }}
                                                sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                                            >
                                                None installed · Browse Marketplace →
                                            </Button>
                                        ),
                                    ],
                                ] as Array<[string, ReactNode]>
                            ).map(([k, v], i) => (
                                <Box
                                    key={k}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '160px 1fr',
                                        px: 3,
                                        py: 2,
                                        borderBottom:
                                            i < 3 ? `1px solid ${ATLAS_PALETTE.slate06}` : 'none',
                                        bgcolor:
                                            i % 2 === 0
                                                ? ATLAS_PALETTE.white
                                                : ATLAS_PALETTE.slate08,
                                    }}
                                >
                                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                        {k}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 12,
                                            color: ATLAS_PALETTE.slate,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {v}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={addAnother}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Add another
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                endIcon={<ArrowForward />}
                                onClick={openProject}
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
                                bgcolor: 'rgba(220,38,38,.06)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            <strong>{err.headline}</strong>
                            <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                {err.suggestion}
                            </Box>
                        </Alert>

                        <Box sx={{ mt: 3 }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    mb: 1,
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    clone-repo.ps1 · stderr
                                </Typography>
                                <Button
                                    size="small"
                                    startIcon={<ContentCopyRounded sx={{ fontSize: 14 }} />}
                                    onClick={copyStderr}
                                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                                >
                                    Copy
                                </Button>
                            </Box>
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
                                {[
                                    'Pick a different credential',
                                    'Verify the repo URL is reachable from your machine',
                                    'Update the PAT’s repo scope in Settings → Credentials',
                                ].map((t) => (
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
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Close
                            </Button>
                            <Button
                                variant="outlined"
                                onClick={() => {
                                    setCloneId(null);
                                    setView('form');
                                }}
                                sx={{ textTransform: 'none' }}
                            >
                                Edit details
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                onClick={handleRetry}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Retry
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'connect_error' && verifyError && (
                    <>
                        <ConnectErrorDetails
                            error={verifyError}
                            folder={existingFolder}
                            repoUrl={repoUrl}
                        />

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="outlined"
                                onClick={() => {
                                    setVerifyError(null);
                                    setView('form');
                                }}
                                sx={{ textTransform: 'none' }}
                            >
                                Pick different folder
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                onClick={() => {
                                    setVerifyError(null);
                                    void startConnect();
                                }}
                                disabled={verifying}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Re-verify
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Dialog>
    );
}
