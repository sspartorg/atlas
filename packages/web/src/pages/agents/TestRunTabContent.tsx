import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import type { IAgent, SSEEvent } from '@atlas/shared';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { api } from '../../api/api.js';
import type { AgentView } from './agentViewModel.js';
import { LiveDot } from '../../components/LiveDot.js';

interface Props {
    agent: IAgent;
    view: AgentView;
}

interface OutputLine {
    ts: string;
    text: string;
    kind: 'cmd' | 'info' | 'success' | 'warn' | 'plain' | 'err';
}

function stamp(d: Date): string {
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

const LINE_COLOR: Record<OutputLine['kind'], string> = {
    cmd: ATLAS_PALETTE.slate,
    info: ATLAS_PALETTE.slate60,
    success: ATLAS_PALETTE.success,
    warn: ATLAS_PALETTE.warning,
    err: ATLAS_PALETTE.error,
    plain: ATLAS_PALETTE.slate60,
};

export function TestRunTabContent({ agent, view: _view }: Props) {
    const toast = useToast();
    const [prompt, setPrompt] = useState('');
    const [lines, setLines] = useState<OutputLine[]>([]);
    const [running, setRunning] = useState(false);
    const [activeDryRunId, setActiveDryRunId] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [exitCode, setExitCode] = useState<number | null>(null);

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const tickRef = useRef<number | null>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [lines]);

    useEffect(() => {
        if (startedAt === null) {
            /* v8 ignore next -- tickRef.current is always null here in practice: startedAt is this effect's own dep, so any transition to null runs the interval-branch's cleanup (below) first, which already clears + nulls tickRef.current before this body re-executes. Kept as defense-in-depth against a future refactor that decouples the interval ref from this effect's lifecycle. */
            if (tickRef.current) window.clearInterval(tickRef.current);
            tickRef.current = null;
            return;
        }
        tickRef.current = window.setInterval(() => {
            setElapsed(((Date.now() - startedAt) / 1000));
        }, 100);
        return () => {
            if (tickRef.current) window.clearInterval(tickRef.current);
            tickRef.current = null;
        };
    }, [startedAt]);

    useEffect(
        () => () => {
            esRef.current?.close();
            esRef.current = null;
        },
        []
    );

    function appendLine(text: string, kind: OutputLine['kind'] = 'plain') {
        setLines((prev) => [...prev, { ts: stamp(new Date()), text, kind }]);
    }

    async function start() {
        setLines([]);
        setExitCode(null);
        setRunning(true);
        setStartedAt(Date.now());
        // Mirror the server-side invocation shape from `dry-run.ts` so the
        // displayed command matches what actually ran. Claude reads the
        // ping prompt from stdin (`--print`); copilot takes it as `-p`.
        // Model name is normalized server-side (hyphen → dot for copilot's
        // claude-* IDs) — preview here with the same mapping so the
        // displayed line matches the spawned argv.
        const rawModel = agent.model || (agent.cli === 'claude' ? 'sonnet' : 'gpt-5');
        const modelLabel = agent.cli === 'copilot'
            ? rawModel.replace(/^(claude-(?:sonnet|haiku|opus))-(\d+)-(\d+)$/, '$1-$2.$3')
            : rawModel;
        const commandPreview = agent.cli === 'claude'
            ? `$ claude --print --model ${modelLabel} --output-format text (ping via stdin)`
            : `$ copilot -p "<ping>" --model ${modelLabel} --allow-all-tools --no-color`;
        appendLine(commandPreview, 'cmd');

        let dryRunId: string;
        try {
            const res = await api.agents.startDryRun(agent.id, prompt.trim() || null);
            dryRunId = res.dryRunId;
            setActiveDryRunId(dryRunId);
            appendLine(
                `[test] queued · id=${dryRunId.slice(0, 8)} · cli=${res.cli} · model=${res.model} · ping prompt (${res.promptLen} chars)`,
                'info'
            );
        } catch (err) {
            appendLine(`[error] failed to start test run: ${(err as Error).message}`, 'err');
            setRunning(false);
            setStartedAt(null);
            return;
        }

        const es = new EventSource('/api/events');
        esRef.current = es;
        es.onmessage = (e: MessageEvent) => {
            try {
                const event = JSON.parse(e.data as string) as SSEEvent;
                if (event.dryRunId !== dryRunId) return;

                if (event.type === 'dry_run_started') {
                    if (event.output) appendLine(event.output, 'info');
                } else if (event.type === 'dry_run_output') {
                    const kind: OutputLine['kind'] = event.stream === 'stderr' ? 'err' : 'plain';
                    if (event.output) appendLine(event.output, kind);
                } else if (event.type === 'dry_run_done') {
                    const ec = event.exitCode ?? -1;
                    setExitCode(ec);
                    // The server formats the verdict into `event.output` —
                    // see formatVerdict() in services/dry-run.ts. We render
                    // it as the final line so users see "connection ok · 2.3s"
                    // (or the failure equivalent) immediately on close.
                    appendLine(
                        event.output ?? `[test] done · exit=${ec}`,
                        ec === 0 ? 'success' : 'warn'
                    );
                    setRunning(false);
                    setStartedAt(null);
                    es.close();
                    esRef.current = null;
                }
            } catch {
                /* ignore heartbeat / parse errors */
            }
        };
        es.onerror = () => {
            appendLine('[sse] connection error — output may stop streaming', 'err');
        };
    }

    function stop() {
        esRef.current?.close();
        esRef.current = null;
        setRunning(false);
        setStartedAt(null);
        appendLine('[test] stopped by user (client-side only — server may still finish)', 'warn');
    }

    const statusLabel = running ? 'Live' : lines.length > 0 ? (exitCode === 0 ? 'Done' : exitCode === null ? 'Idle' : 'Failed') : 'Idle';
    const statusColor = running
        ? ATLAS_PALETTE.success
        : statusLabel === 'Done'
          ? ATLAS_PALETTE.success
          : statusLabel === 'Failed'
            ? ATLAS_PALETTE.error
            : ATLAS_PALETTE.slate60;
    const statusSoftBg = running || statusLabel === 'Done'
        ? ATLAS_PALETTE.successSoft
        : statusLabel === 'Failed'
          ? ATLAS_PALETTE.dangerSoft
          : ATLAS_PALETTE.accentSoft;

    return (
        <Box>
            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 3,
                    mb: 2.5,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 0.75,
                    }}
                >
                    Live CLI test run
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                    Real LLM round-trip — sends a one-line ping (&quot;reply with the single
                    word OK&quot;) to the agent&apos;s configured CLI and model, then waits for
                    the response. Verifies the binary is on PATH, credentials are valid, and
                    the model accepts requests. No issue, no agent prompt, no handoffs, no MCP.
                </Typography>
                <Typography
                    sx={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate60,
                        mb: 0.75,
                    }}
                >
                    Extra prompt line (optional, appended after the ping)
                </Typography>
                <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    sx={{
                        '& .MuiInputBase-input': {
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontSize: 12.5,
                            lineHeight: 1.6,
                        },
                    }}
                />
                <Typography
                    sx={{
                        fontSize: 11.5,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate40,
                        mt: 1.25,
                    }}
                >
                    cli · {agent.cli} · model · {agent.model || '(unset)'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                    <Button
                        variant="contained"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18 }}
                            >
                                play_arrow
                            </Box>
                        }
                        onClick={() => void start()}
                        disabled={running}
                        sx={{
                            textTransform: 'none',
                            bgcolor: ATLAS_PALETTE.green,
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                        }}
                    >
                        Run test
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18 }}
                            >
                                stop
                            </Box>
                        }
                        onClick={stop}
                        disabled={!running}
                        sx={{
                            textTransform: 'none',
                            color: ATLAS_PALETTE.slate,
                            borderColor: ATLAS_PALETTE.slate12,
                            bgcolor: ATLAS_PALETTE.white,
                            '&:hover': {
                                borderColor: ATLAS_PALETTE.slate30,
                                bgcolor: ATLAS_PALETTE.slate08,
                            },
                        }}
                    >
                        Stop
                    </Button>
                </Box>
            </Box>

            <Box
                sx={{
                    background: ATLAS_PALETTE.surfaceRaised,
                    borderRadius: '12px',
                    overflow: 'hidden',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 2.5,
                        py: 1.5,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                color: ATLAS_PALETTE.slate60,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                            }}
                        >
                            Output
                        </Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                px: 1,
                                py: 0.25,
                                borderRadius: '999px',
                                background: statusSoftBg,
                            }}
                        >
                            {running ? (
                                <LiveDot size={7} hex={statusColor} label="Running" />
                            ) : (
                                <Box
                                    sx={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '999px',
                                        background: statusColor,
                                    }}
                                />
                            )}
                            <Typography
                                sx={{
                                    fontSize: 10.5,
                                    color: statusColor,
                                    fontWeight: 500,
                                }}
                            >
                                {statusLabel}
                            </Typography>
                        </Box>
                    </Box>
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            color: ATLAS_PALETTE.slate40,
                        }}
                    >
                        {activeDryRunId
                            ? `test ${activeDryRunId.slice(0, 8)} · ${elapsed.toFixed(1)}s`
                            : 'no test yet'}
                    </Typography>
                </Box>
                <Box
                    ref={scrollRef}
                    sx={{
                        p: 2,
                        maxHeight: 360,
                        overflow: 'auto',
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 12,
                        lineHeight: 1.7,
                    }}
                >
                    {lines.length === 0 ? (
                        <Typography
                            sx={{
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate40,
                            }}
                        >
                            {`Press "Run test" to invoke the live CLI. Real LLM call — output streams here.`}
                        </Typography>
                    ) : (
                        lines.map((line, i) => (
                            <Box key={i} sx={{ display: 'flex', gap: 1.5 }}>
                                <Typography
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontSize: 11.5,
                                        color: ATLAS_PALETTE.slate40,
                                        flexShrink: 0,
                                    }}
                                >
                                    [{line.ts}]
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontSize: 12,
                                        color: LINE_COLOR[line.kind],
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {line.text}
                                </Typography>
                            </Box>
                        ))
                    )}
                </Box>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 2.5,
                        py: 1.25,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        {exitCode === null
                            ? running
                                ? 'streaming…'
                                : 'idle'
                            : `exit ${exitCode} · ${elapsed.toFixed(1)}s`}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Typography
                            onClick={() => {
                                void navigator.clipboard.writeText(
                                    lines.map((l) => `[${l.ts}] ${l.text}`).join('\n')
                                );
                                toast.show({ message: 'Output copied' });
                            }}
                            sx={{
                                fontSize: 11.5,
                                color: ATLAS_PALETTE.brandBlue,
                                cursor: 'pointer',
                                '&:hover': { textDecoration: 'underline' },
                            }}
                        >
                            Copy log
                        </Typography>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
