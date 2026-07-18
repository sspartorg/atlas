import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiErrorKind, IAgentRun, IssueType, RunStatus } from '@atlas/shared';
import { useAgent, useAgentRun } from '../hooks/useAgents.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { AtlasApiError } from '../api/api.js';
import { useRunOutputTail } from '../hooks/useRunOutputTail.js';
import { QueueLiveLog } from './queue/QueueLiveLog.js';
import { useAiEnabled } from '../hooks/useAiEnabled.js';
import { isSimulatedRun } from '../utils/isSimulatedRun.js';
import { SimulatedBadge } from '../components/SimulatedBadge.js';
import { useToast } from '../hooks/useToast.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { ConfirmActionModal } from '../components/ConfirmActionModal.js';
import { RunEventViewer } from '../components/RunEventViewer.js';
import { AiUsagePanel } from '../components/AiUsagePanel.js';
import { api } from '../api/api.js';
import { ATLAS_PALETTE, TYPOGRAPHY, MOBILE_SHELL } from '../theme/tokens.js';
import { runStatusPaletteEntry } from '../theme/runStatusPalette.js';
import { relativeTime } from './agents/agentViewModel.js';

// Run-status colour previously lived inline as `RUN_STATUS_COLOR` here,
// pulling Mercury brand-hue slots (`ATLAS_PALETTE.green` / `.cerulean`)
// that collapsed to black/white. Now centralised in `runStatusPalette.ts`
// as `{ bg, fg }` pairs so every run surface stays in sync.

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
    queued: 'Queued',
    in_progress: 'In progress',
    completed: 'Completed',
    error: 'Error',
    cancelled: 'Cancelled',
    setup_failed: 'Setup failed',
};

// The final `result` event carries the agent's natural-language wrap-up in
// its `result` field — that's what used to be "the last paragraph" back when
// output was plain text. With stream-json we can pluck it directly. Returns
// '' when the run hasn't finished or didn't emit a result event.
function extractFinalResult(output: string | null): string {
    if (!output) return '';
    const lines = output.split(/\r?\n/);
    // Claude: a final `{type: 'result', result: '<text>'}` line — pluck
    // the text. Copilot's `result` event has no string payload, so we
    // fall back to the last `assistant.message` block's `data.content`
    // (which is the model's final reply).
    for (let i = lines.length - 1; i >= 0; i--) {
        /* v8 ignore next -- unreachable: `i` always indexes within `lines`, so `lines[i]` is never undefined; `?? ''` only satisfies noUncheckedIndexedAccess */
        const line = (lines[i] ?? '').trim();
        if (!line.startsWith('{')) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj['type'] === 'result' && typeof obj['result'] === 'string') {
                return (obj['result'] as string).trim();
            }
        } catch {
            /* keep searching */
        }
    }
    // Copilot fallback — last `assistant.message` with a string `data.content`.
    for (let i = lines.length - 1; i >= 0; i--) {
        /* v8 ignore next -- unreachable: same noUncheckedIndexedAccess guard as the loop above */
        const line = (lines[i] ?? '').trim();
        if (!line.startsWith('{')) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj['type'] === 'assistant.message') {
                const data = obj['data'] as Record<string, unknown> | undefined;
                if (data && typeof data['content'] === 'string' && (data['content'] as string).trim()) {
                    return (data['content'] as string).trim();
                }
            }
        } catch {
            /* keep searching */
        }
    }
    return '';
}

// W4 — Parse the `[error-kind:KIND[:JSON]]` marker the API runner prepends
// to `output_text` for classified failures (currently ENOENT on the CLI
// binary). Returns null when no marker is present, so the page falls back
// to the generic error tail.
const ERROR_KIND_RE = /\[error-kind:([a-z_]+)(:\{[^\]]*\})?\]/;
function parseErrorKindMarker(output: string | null | undefined): {
    kind: ApiErrorKind;
    details: unknown;
} | null {
    if (!output) return null;
    const head = output.slice(0, 512);
    const m = ERROR_KIND_RE.exec(head);
    if (!m || !m[1]) return null;
    let details: unknown;
    if (m[2]) {
        try {
            details = JSON.parse(m[2].slice(1));
        } catch {
            /* malformed JSON in marker — ignore details */
        }
    }
    return { kind: m[1] as ApiErrorKind, details };
}

function issuePath(type: IssueType, id: string): string {
    if (type === 'epic') return `/epics/${id}`;
    if (type === 'story') return `/issues/stories/${id}`;
    if (type === 'bug') return `/issues/bugs/${id}`;
    if (type === 'sub_task') return `/issues/sub-tasks/${id}`;
    return `/issues/sub-bugs/${id}`;
}

function durationLabel(run: IAgentRun): string {
    if (!run.started_at) return '—';
    const end = run.completed_at ? new Date(run.completed_at) : new Date();
    const start = new Date(run.started_at);
    const sec = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function AgentRunDetail() {
    const { id = '', runId = '' } = useParams<{ id: string; runId: string }>();
    const navigate = useNavigate();
    const toast = useToast();
    const isMobile = useIsMobile();

    const { data: agent, isLoading: agentLoading } = useAgent(id);
    const { data: run, isLoading: runLoading } = useAgentRun(runId);
    const { aiEnabled } = useAiEnabled();

    // Live tail of agent_output SSE events for the run in view. While the run
    // is still in_progress we render this above the master-detail viewer —
    // same component the Queue drawer uses — so the user doesn't have to
    // navigate away to see streaming output. Once the run finishes, useSSE
    // invalidates ['agent-run', runId] and `output_text` arrives, which the
    // master-detail viewer parses; the live log naturally goes quiet.
    const { lines: liveLines, isLive, hasReceivedFirstEvent } = useRunOutputTail(runId);
    const queryClient = useQueryClient();

    const summary = useMemo(() => extractFinalResult(run?.output_text ?? null), [run?.output_text]);
    // W4 — typed banner when the agent-runner classified the failure (e.g.
    // `claude` not on PATH). Synthesizes a AtlasApiError so the existing
    // ApiErrorAlert component can render the per-kind copy.
    const errorMarker = useMemo(
        () =>
            run?.status === 'error' ? parseErrorKindMarker(run?.output_text ?? null) : null,
        [run?.status, run?.output_text],
    );
    const errorForAlert = useMemo(
        () =>
            errorMarker
                ? new AtlasApiError(
                      /* v8 ignore next -- unreachable: errorMarker is only truthy when parseErrorKindMarker saw a non-empty output_text, so this fallback never fires */
                      run?.output_text?.slice(0, 200) ?? 'Run failed',
                      errorMarker.kind,
                      0,
                      errorMarker.details,
                  )
                : null,
        [errorMarker, run?.output_text],
    );

    // Selection state, view-mode default, scroll-into-view, and parsing
    // all live inside <RunEventViewer> now (used by both this page and the
    // terminal history page). We just pass the raw output_text and the
    // source so the viewer's preview extractor branches correctly.

    // Confirm before navigating away from a live run. The run now survives
    // a tab close (10s flush + boot-time orphan cleanup) but the user is
    // almost always watching for a reason; the prompt prevents an accidental
    // refresh from feeling like work was lost. Active only while the run is
    // actually in-flight.
    useEffect(() => {
        if (run?.status !== 'in_progress' && run?.status !== 'queued') return;
        const handler = (e: BeforeUnloadEvent): void => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [run?.status]);

    // Gap-fill: after a page reload during an in-flight run, the initial
    // REST fetch returns `output_text` as of the last 10s flush. The
    // global SSE only delivers events emitted AFTER it opens. Anything
    // emitted between the flush and the SSE handshake would be invisible
    // unless we re-poll. Once the SSE confirms it's tailing (first event
    // arrived), do ONE refetch with ?since=<bytes-we-have> and splice the
    // tail into the cached run row. Fires at most once per runId.
    const gapFilledForRunRef = useRef<string | null>(null);
    useEffect(() => {
        if (!runId || !run) return;
        if (gapFilledForRunRef.current === runId) return;
        if (run.status !== 'queued' && run.status !== 'in_progress') return;
        if (!hasReceivedFirstEvent) return;
        gapFilledForRunRef.current = runId;
        const baseLen = (run.output_text ?? '').length;
        void api.run
            .get(runId, { since: baseLen })
            .then((fresh) => {
                const tail = fresh.output_text ?? '';
                if (!tail) return;
                queryClient.setQueryData<IAgentRun>(['agent-run', runId], (prev) =>
                    prev ? { ...prev, output_text: (prev.output_text ?? '') + tail } : prev,
                );
            })
            .catch(() => {
                /* gap fill is best-effort; SSE is still streaming */
            });
    }, [runId, run, hasReceivedFirstEvent, queryClient]);

    useSetPageTitle(run ? `Run ${runId.slice(0, 8)}` : 'Run');

    const rerun = useMutation({
        mutationFn: () => {
            /* v8 ignore next -- unreachable: the Re-run button only renders after the `!run` early-return above */
            if (!run) throw new Error('Run not loaded');
            return api.run.trigger(run.agent_id, run.issue_type, run.issue_id);
        },
        onSuccess: ({ runId: newRunId }) => {
            toast.show({ message: 'Re-run queued' });
            navigate(`/agents/${id}/runs/${newRunId}`);
        },
        onError: (e) =>
            toast.show({ message: 'Re-run failed', detail: (e as Error).message }),
    });

    // Workstream #6 — Stop-a-run kill switch. Only enabled while the
    // run is queued or in_progress (the button is hidden otherwise).
    // Idempotent on the server: a 409 from an already-terminal row is
    // caught and shown as a benign toast — the row's status is
    // refetched anyway, so the UI converges.
    const stopRun = useMutation({
        mutationFn: () => api.run.stop(runId),
        onSuccess: (resp) => {
            toast.show({ message: 'Run stopped' });
            // Optimistic patch: the server response already tells us the
            // terminal status (usually `cancelled`; in the runner-finalised-
            // first race it can be `completed`/`error`). Apply it to the
            // cached run row immediately so the Stop button hides and the
            // status pill flips on the next render tick — without waiting
            // for SSE or a refetch round-trip. If SSE is dropped by a dev
            // proxy or the EventSource is mid-reconnect, this is what
            // keeps the UI from looking stuck.
            queryClient.setQueryData<IAgentRun>(['agent-run', runId], (prev) =>
                prev
                    ? {
                          ...prev,
                          status: resp.status,
                          completed_at: prev.completed_at ?? new Date().toISOString(),
                      }
                    : prev,
            );
            void queryClient.invalidateQueries({ queryKey: ['agent-run', runId] });
        },
        onError: (e) =>
            toast.show({ message: 'Stop failed', detail: (e as Error).message }),
    });

    const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

    function handleStop() {
        setStopConfirmOpen(true);
    }

    function confirmStop() {
        setStopConfirmOpen(false);
        stopRun.mutate();
    }

    function handleCopyLog() {
        const text = run?.output_text ?? '';
        if (!text) {
            toast.show({ message: 'Nothing to copy yet' });
            return;
        }
        void navigator.clipboard
            .writeText(text)
            .then(() => toast.show({ message: 'Log copied' }))
            .catch((e) =>
                toast.show({ message: 'Copy failed', detail: (e as Error).message })
            );
    }

    function handleDownloadLog() {
        const text = run?.output_text ?? '';
        if (!text) {
            toast.show({ message: 'Nothing to download yet' });
            return;
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${runId.slice(0, 8)}.log`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    if (agentLoading || runLoading) {
        return (
            <Box sx={{ p: 8, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    if (!run || !agent) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}>
                    Run not found.
                </Typography>
            </Box>
        );
    }

    const statusPalette = runStatusPaletteEntry(run.status);
    const statusLabel = RUN_STATUS_LABEL[run.status];
    const stickyBottom = isMobile
        ? `calc(${MOBILE_SHELL.bottomNavHeight}px + env(safe-area-inset-bottom))`
        : 0;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4, pb: { xs: 18, md: 4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                <Box
                    component={RouterLink}
                    to="/agents"
                    sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 12.5, textDecoration: 'none' }}
                >
                    Agents
                </Box>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>/</Typography>
                <Box
                    component={RouterLink}
                    to={`/agents/${agent.id}`}
                    sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 12.5, textDecoration: 'none' }}
                >
                    {agent.name}
                </Box>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>/</Typography>
                <Box
                    component={RouterLink}
                    to={`/agents/${agent.id}?tab=runs`}
                    sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 12.5, textDecoration: 'none' }}
                >
                    Runs
                </Box>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>/</Typography>
                <Typography
                    sx={{
                        fontSize: 12.5,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {runId.slice(0, 8)}
                </Typography>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 2,
                    mb: 3,
                }}
            >
                <Box>
                    <Typography
                        sx={{
                            fontSize: { xs: 28, md: 36 },
                            fontWeight: 700,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            letterSpacing: '-0.01em',
                            color: ATLAS_PALETTE.slate,
                            mb: 1,
                        }}
                    >
                        {runId.slice(0, 8)}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            {/* Single mid-tone dot — see runStatusPalette
                                comment for why we no longer paint pastel
                                bg + tonal border at this size. */}
                            <Box
                                sx={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: '9999px',
                                    background: statusPalette.dot,
                                    flexShrink: 0,
                                }}
                            />
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    fontWeight: 500,
                                    color: statusPalette.fg,
                                }}
                            >
                                {statusLabel}
                            </Typography>
                        </Box>
                        {isSimulatedRun(run /* v8 ignore next -- unreachable: `run` is guaranteed non-null by the `!run` early-return above */ ?? null, aiEnabled) && <SimulatedBadge size="sm" />}
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            {agent.name}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Started {run.started_at ? relativeTime(run.started_at) : '—'}
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Duration {durationLabel(run)}
                        </Typography>
                    </Box>
                </Box>

                {!isMobile && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {(run.status === 'queued' || run.status === 'in_progress') && (
                            <Button
                                variant="outlined"
                                onClick={handleStop}
                                disabled={stopRun.isPending}
                                startIcon={
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 18 }}
                                    >
                                        stop_circle
                                    </Box>
                                }
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.error,
                                    borderColor: ATLAS_PALETTE.error,
                                    bgcolor: ATLAS_PALETTE.white,
                                    '&:hover': {
                                        bgcolor: ATLAS_PALETTE.dangerSoft,
                                        borderColor: ATLAS_PALETTE.error,
                                    },
                                }}
                            >
                                Stop run
                            </Button>
                        )}
                        <Button
                            variant="contained"
                            onClick={() => rerun.mutate()}
                            disabled={rerun.isPending}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 18 }}
                                >
                                    replay
                                </Box>
                            }
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
                            Re-run with same inputs
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={handleCopyLog}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 18 }}
                                >
                                    content_copy
                                </Box>
                            }
                            sx={{
                                textTransform: 'none',
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate,
                                borderColor: ATLAS_PALETTE.slate12,
                                bgcolor: ATLAS_PALETTE.white,
                            }}
                        >
                            Copy log
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={handleDownloadLog}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 18 }}
                                >
                                    download
                                </Box>
                            }
                            sx={{
                                textTransform: 'none',
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate,
                                borderColor: ATLAS_PALETTE.slate12,
                                bgcolor: ATLAS_PALETTE.white,
                            }}
                        >
                            Download log
                        </Button>
                    </Box>
                )}
            </Box>

            <Box
                component={RouterLink}
                to={issuePath(run.issue_type, run.issue_id)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 2,
                    mb: 3,
                    borderRadius: '8px',
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    background: ATLAS_PALETTE.white,
                    textDecoration: 'none',
                    transition: 'border-color 120ms ease, background 120ms ease',
                    '&:hover': {
                        borderColor: ATLAS_PALETTE.brandBlue,
                        background: ATLAS_PALETTE.slate06,
                    },
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 18, color: ATLAS_PALETTE.brandBlue }}
                >
                    flag
                </Box>
                <Typography
                    sx={{
                        fontSize: 12,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {run.issue_type} / {run.issue_id}
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 500 }}>
                    Open issue
                </Typography>
                <Box sx={{ ml: 'auto' }}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40 }}
                    >
                        chevron_right
                    </Box>
                </Box>
            </Box>

            {/* W4 — kind-aware banner when the runner classified the
                failure. Shown above the raw log so the Owner sees the
                next-action copy before scrolling. */}
            {errorForAlert && (
                <Box sx={{ mb: 2 }}>
                    <ApiErrorAlert
                        error={errorForAlert}
                        contextLabel="Run failed"
                    />
                </Box>
            )}

            {/* Live tail — mounted while the run is still queued or
                streaming. While queued, useRunOutputTail is already live
                (it activates on runId) and the panel shows the "Waiting
                for output…" empty state; when the runner picks the row
                up and emits `agent_status: in_progress`, the cache
                refresh from useSSE keeps the same panel mounted and
                lines start filling in. The flicker the chunk's third AC
                calls out is gone because the DOM doesn't swap on the
                queued → in_progress flip. Once the run hits completed
                /error, this hides and the master-detail viewer below
                renders with parsed `output_text`. */}
            {(run.status === 'queued' || run.status === 'in_progress') && (
                <Box sx={{ mb: 1.5 }}>
                    <QueueLiveLog
                        lines={liveLines}
                        isLive={isLive}
                        accent={agent?.accent_color ?? ATLAS_PALETTE.cerulean}
                    />
                </Box>
            )}

            {/* 2026-06-10 — Setup-failed surface. When the per-project
                setup script exits non-zero / times out / references an
                unknown ${'${'}variable.KEY}, the runner finalizes the run
                with status='setup_failed' and captures stdout+stderr
                (secret values redacted) into `setup_output_text`. The
                CLI never spawned, so there's no event timeline to
                render — just the captured output and a hint pointing
                at the project's Setup tab + Settings > Shared Secrets. */}
            {run.status === 'setup_failed' && (
                <Box sx={{ mb: 1.5 }}>
                    <Alert
                        severity="warning"
                        sx={{
                            mb: 1.5,
                            bgcolor: 'rgba(168,106,31,.08)',
                            color: ATLAS_PALETTE.slate,
                            border: `1px solid rgba(168,106,31,.20)`,
                        }}
                    >
                        The per-project setup script did not complete cleanly. The agent CLI was
                        not spawned. Edit the project&apos;s Setup tab or check Settings &gt;
                        Shared Secrets, then re-dispatch.
                    </Alert>
                    <Box
                        component="pre"
                        sx={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                            bgcolor: ATLAS_PALETTE.slate06,
                            color: ATLAS_PALETTE.slate,
                            p: 2,
                            borderRadius: 1,
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 480,
                            overflow: 'auto',
                            margin: 0,
                        }}
                    >
                        {run.setup_output_text ?? '(no output captured)'}
                    </Box>
                </Box>
            )}

            {/* Two-pane stream-json viewer (master-detail). Gated to
                terminal states only — `output_text` is null until the
                runner finishes the row, so rendering this block during
                queued/in_progress just shows an empty placeholder under
                the live log. Surfaces during completed/error only.
                Left/top — section index: one row per parsed event with its
                typed header (color-coded by kind) and a short preview.
                Clicking a row selects that event. Selected row is
                highlighted.
                Right/bottom — log pane: shows ONLY the selected event's
                pretty-printed JSON body so the Owner can focus on one
                event at a time. Defaults to event #1 on landing. Non-JSON
                lines (stderr, `gh copilot` plain text) render as text rows
                in both panes.
                Wrapped in a Tabs toggle: Timeline (this master-detail view)
                or Raw text (the full output_text dump). Copilot text-mode
                runs default to Raw text since their content is largely
                plain text with a stderr trailer; Claude defaults to
                Timeline since its NDJSON event cards are the primary signal. */}
            {(run.status === 'completed' || run.status === 'error') && (
                <RunEventViewer
                    content={run.output_text ?? null}
                    source={agent.cli === 'copilot' ? 'copilot' : 'agent-stream-json'}
                    resetKey={runId}
                />
            )}

            {/* Summary panel — the `result` field from Claude's final
                `type:"result"` event, i.e. the agent's own wrap-up. Hoisted
                so the Owner can see "what the agent says it did" without
                expanding every card above. Only shows once the run is
                finished AND a result event landed; nothing to show for
                queued/in-progress runs or for non-Claude CLIs that don't
                emit a structured wrap-up. */}
            {summary &&
                (run.status === 'completed' || run.status === 'error') && (
                    <Box
                        sx={{
                            mt: 3,
                            background: ATLAS_PALETTE.white,
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            borderLeft: `3px solid ${
                                run.status === 'error'
                                    ? ATLAS_PALETTE.error
                                    : ATLAS_PALETTE.green
                            }`,
                            borderRadius: '10px',
                            p: 3,
                        }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: 1.5,
                                mb: 1.5,
                            }}
                        >
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate60,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                {run.status === 'error' ? 'Error tail' : 'Summary'}
                            </Typography>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate40,
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                }}
                            >
                                · from result event
                            </Typography>
                        </Box>
                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12.5,
                                lineHeight: 1.6,
                                color: ATLAS_PALETTE.slate80,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {summary}
                        </Box>
                    </Box>
                )}

            {!isSimulatedRun(run, aiEnabled) && (
                <AiUsagePanel
                    total_cost_usd={run.total_cost_usd}
                    input_tokens={run.input_tokens}
                    output_tokens={run.output_tokens}
                    cache_creation_tokens={run.cache_creation_tokens}
                    cache_read_tokens={run.cache_read_tokens}
                />
            )}

            {isMobile && (
                <Box
                    sx={{
                        position: 'fixed',
                        left: 0,
                        right: 0,
                        bottom: stickyBottom,
                        zIndex: (t) => t.zIndex.appBar - 1,
                        display: 'flex',
                        gap: 1,
                        p: 1.5,
                        background: ATLAS_PALETTE.white,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                >
                    {(run.status === 'queued' || run.status === 'in_progress') && (
                        <Button
                            variant="outlined"
                            fullWidth
                            onClick={handleStop}
                            disabled={stopRun.isPending}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                color: ATLAS_PALETTE.error,
                                borderColor: ATLAS_PALETTE.error,
                                '&:hover': {
                                    bgcolor: ATLAS_PALETTE.dangerSoft,
                                    borderColor: ATLAS_PALETTE.error,
                                },
                            }}
                        >
                            Stop
                        </Button>
                    )}
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={() => rerun.mutate()}
                        disabled={rerun.isPending}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            bgcolor: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        Re-run
                    </Button>
                    <Button
                        variant="outlined"
                        fullWidth
                        onClick={handleCopyLog}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                        }}
                    >
                        Copy log
                    </Button>
                </Box>
            )}
            <ConfirmActionModal
                open={stopConfirmOpen}
                title="Stop this run?"
                body={"Any work the agent already committed will still be pushed, but the chain won't advance."}
                confirmLabel="Stop"
                tone="destructive"
                busy={stopRun.isPending}
                onConfirm={confirmStop}
                onCancel={() => setStopConfirmOpen(false)}
            />
        </Box>
    );
}
