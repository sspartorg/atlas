import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ATLAS_PALETTE, ELEVATION, TYPOGRAPHY } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';
import { LiveDot } from '../../components/LiveDot.js';
import type { DashboardPipelines } from '../../api/types.js';
import { pipelineView } from './pipeline.js';
import type { AgentSummary } from '../../api/types.js';

interface ILivePipelinesProps {
    pipelines: DashboardPipelines | undefined;
    agents: AgentSummary[];
}

const STATION_PITCH = 104;

type ILiveRun = DashboardPipelines['runs'][number];

export function elapsed(startedAt: string, now: number): string {
    const min = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
    if (min < 1) return 'just started';
    const h = Math.floor(min / 60);
    return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

function RunLine({
    run,
    agentsById,
    now,
    reduceMotion,
}: {
    run: ILiveRun;
    agentsById: Map<string, AgentSummary>;
    now: number;
    reduceMotion: boolean;
}) {
    const waiting = run.status === 'waiting_for_owner';
    const { stations, at, detour } = pipelineView(
        run.graph_snapshot,
        (waiting ? run.parked_node_id : null) ?? run.current_node_id,
        agentsById
    );
    const here = at >= 0 ? stations[at] : undefined;
    const accent = waiting ? ATLAS_PALETTE.warning : ATLAS_PALETTE.success;
    const stepText = here
        ? `Step ${at + 1} of ${stations.length}: ${here.label}${detour ? `, fixing with ${detour}` : ''}`
        : 'Starting up';

    return (
        <Box
            component="li"
            sx={{ py: 5, '& + &': { borderTop: `1px solid ${ATLAS_PALETTE.slate06}` } }}
        >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0 }}>
                <Link
                    component={RouterLink}
                    to={`/workflows/${run.workflow_id}/runs/${run.id}`}
                    underline="hover"
                    noWrap
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 15,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    {run.item_title ?? run.workflow_name}
                </Link>
                <Typography
                    sx={{
                        flexShrink: 0,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {elapsed(run.started_at, now)}
                </Typography>
            </Box>
            <Typography sx={{ mt: 0.5, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                {run.workflow_name}
                {run.loop_count > 0
                    ? `, ${run.loop_count} ${run.loop_count === 1 ? 'retry' : 'retries'}`
                    : ''}
                {waiting ? (
                    <Box component="span" sx={{ color: ATLAS_PALETTE.warning, fontWeight: 600 }}>
                        {' '}
                        Needs you{run.park_reason ? `: ${run.park_reason}` : ''}
                    </Box>
                ) : null}
            </Typography>

            {/* The route map: one column per main-line step. Each cell draws
                its half of the line on either side of its station, so the
                stations and their names line up without measuring. Screen
                readers get the one sentence in its label. */}
            <Box
                role="img"
                aria-label={stepText}
                sx={{
                    mt: 5,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${stations.length}, minmax(0, 1fr))`,
                    // Same station spacing on every line, so short workflows
                    // read short instead of stretching across the panel.
                    maxWidth: stations.length * STATION_PITCH,
                }}
            >
                {stations.map((s, i) => {
                    const done = at >= 0 && i < at;
                    const current = i === at;
                    const travelled = (side: 'left' | 'right') =>
                        at >= 0 && (side === 'left' ? i <= at : i < at);
                    const half = (side: 'left' | 'right') => ({
                        content: '""',
                        position: 'absolute',
                        top: 10,
                        height: 0,
                        [side]: 0,
                        width: '50%',
                        borderTop: travelled(side)
                            ? `3px solid ${accent}`
                            : `2px dashed ${ATLAS_PALETTE.slate12}`,
                        mt: travelled(side) ? '-1.5px' : '-1px',
                    });
                    return (
                        <Box
                            key={s.id}
                            sx={{
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                minWidth: 0,
                                '&::before': i > 0 ? half('left') : undefined,
                                '&::after': i < stations.length - 1 ? half('right') : undefined,
                            }}
                        >
                            <Box
                                title={s.label}
                                sx={{
                                    position: 'relative',
                                    zIndex: 1,
                                    height: 20,
                                    display: 'flex',
                                    alignItems: 'center',
                                }}
                            >
                                {current ? (
                                    <Box
                                        sx={{
                                            width: 20,
                                            height: 20,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: '50%',
                                            border: `3px solid ${accent}`,
                                            bgcolor: 'background.paper',
                                        }}
                                    >
                                        <LiveDot
                                            size={8}
                                            hex={accent}
                                            label={s.label}
                                            animate={!reduceMotion && !waiting}
                                        />
                                    </Box>
                                ) : (
                                    <Box
                                        sx={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: '50%',
                                            bgcolor: done ? accent : 'background.paper',
                                            border: `2px solid ${done ? accent : ATLAS_PALETTE.slate30}`,
                                        }}
                                    />
                                )}
                            </Box>
                            <Typography
                                sx={{
                                    // Long lines only name the current stop.
                                    display: {
                                        xs: current ? 'block' : 'none',
                                        md: current || stations.length <= 12 ? 'block' : 'none',
                                    },
                                    mt: 2,
                                    px: 0.5,
                                    maxWidth: '100%',
                                    textAlign: 'center',
                                    fontSize: current ? 12 : 11,
                                    lineHeight: 1.3,
                                    fontWeight: current ? 700 : 400,
                                    color: current
                                        ? ATLAS_PALETTE.slate
                                        : done
                                          ? ATLAS_PALETTE.slate70
                                          : ATLAS_PALETTE.slate60,
                                    overflow: 'hidden',
                                    // Narrow cells can't hold the current name:
                                    // let it overflow its column, centred.
                                    ...(current && {
                                        overflow: 'visible',
                                        whiteSpace: 'nowrap',
                                        maxWidth: 'none',
                                        alignSelf:
                                            i === 0
                                                ? 'flex-start'
                                                : i === stations.length - 1
                                                  ? 'flex-end'
                                                  : 'center',
                                    }),
                                }}
                            >
                                {s.label}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>

            {(detour || !here) && (
                <Typography sx={{ mt: 3, fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {here ? `Fixing with ${detour}, then back to ${here.label}` : 'Starting up'}
                </Typography>
            )}
        </Box>
    );
}

const IDLE_STOPS = 7;
const IDLE_CYCLE_S = 6;

// Empty state: an empty route with a light running along it, lighting each
// stop as it passes, so the panel reads as "ready, waiting for work". Only
// transform and opacity animate, inside a strictly contained box.
function IdleLine({ animate }: { animate: boolean }) {
    return (
        // The animations restyle this box every frame; strict containment keeps
        // that work inside it instead of the whole page (measured on the perf
        // seed at 4x CPU: ~14% → ~4% main-thread while idle). Containment also
        // clips, so the box leaves room for the end stops and the glow.
        <Box
            aria-hidden="true"
            sx={{
                contain: 'strict',
                height: 32,
                px: '8px',
                maxWidth: (IDLE_STOPS - 1) * STATION_PITCH + 16,
                mx: 'auto',
            }}
        >
            <Box
                sx={{
                    position: 'relative',
                    height: '100%',
                    '@keyframes atlas-idle-travel': {
                        '0%': { transform: 'translateX(0)', opacity: 0 },
                        '8%': { opacity: 1 },
                        '88%': { opacity: 1 },
                        '100%': { transform: 'translateX(100%)', opacity: 0 },
                    },
                    '@keyframes atlas-idle-stop': {
                        '0%': { opacity: 0, transform: 'scale(0.4)' },
                        '4%': { opacity: 1, transform: 'scale(1)' },
                        '30%': { opacity: 0, transform: 'scale(1)' },
                        '100%': { opacity: 0 },
                    },
                }}
            >
                <Box
                    sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: '50%',
                        borderTop: `2px dashed ${ATLAS_PALETTE.slate12}`,
                        mt: '-1px',
                    }}
                />
                {Array.from({ length: IDLE_STOPS }, (_, i) => (
                    <Box
                        key={i}
                        sx={{
                            position: 'absolute',
                            top: '50%',
                            left: `${(i / (IDLE_STOPS - 1)) * 100}%`,
                            width: 10,
                            height: 10,
                            mt: '-5px',
                            ml: '-5px',
                            borderRadius: '50%',
                            border: `2px solid ${ATLAS_PALETTE.slate30}`,
                            bgcolor: 'background.paper',
                        }}
                    >
                        {animate && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    inset: -2,
                                    borderRadius: '50%',
                                    bgcolor: ATLAS_PALETTE.success,
                                    opacity: 0,
                                    animation: `atlas-idle-stop ${IDLE_CYCLE_S}s linear infinite`,
                                    animationDelay: `${(i / (IDLE_STOPS - 1)) * IDLE_CYCLE_S}s`,
                                }}
                            />
                        )}
                    </Box>
                ))}
                {animate && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            animation: `atlas-idle-travel ${IDLE_CYCLE_S}s linear infinite`,
                            willChange: 'transform, opacity',
                        }}
                    >
                        <Box
                            sx={{
                                position: 'absolute',
                                top: '50%',
                                left: 0,
                                width: 8,
                                height: 8,
                                mt: '-4px',
                                ml: '-4px',
                                borderRadius: '50%',
                                bgcolor: ATLAS_PALETTE.success,
                                boxShadow: `0 0 10px 2px ${ATLAS_PALETTE.success}`,
                            }}
                        />
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// The page's anchor: every Task run in flight, drawn as its workflow's main
// line with the current step lit. Data rides on GET /api/dashboard, which
// SSE refreshes as runs move (`workflow_run_updated`).
export function LivePipelines({ pipelines, agents }: ILivePipelinesProps) {
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    const agentsById = new Map(agents.map((a) => [a.id, a]));
    const live = pipelines?.runs ?? [];
    const queued = pipelines?.queued ?? [];
    const unassigned = pipelines?.unassigned ?? 0;

    return (
        <Paper
            elevation={0}
            component="section"
            aria-labelledby="running-heading"
            sx={{
                bgcolor: 'background.paper',
                borderRadius: '8px',
                boxShadow: ELEVATION.low,
                p: 5,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 3,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <Box id="running-heading">
                        <FormHeading>Running now</FormHeading>
                    </Box>
                    {live.length > 0 && (
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            {live.length} {live.length === 1 ? 'task' : 'tasks'}
                        </Typography>
                    )}
                </Box>
                <Link
                    component={RouterLink}
                    to="/queue"
                    underline="hover"
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, py: '6px', my: '-6px' }}
                >
                    Open queue
                </Link>
            </Box>

            {live.length === 0 ? (
                <Box sx={{ mt: 5, textAlign: 'center' }}>
                    <IdleLine animate={!reduceMotion} />
                    <Typography
                        sx={{ mt: 4, fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                    >
                        Nothing is running.
                    </Typography>
                    <Typography sx={{ mt: 1, fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        Tasks you queue for a workflow show up here, step by step, as they move
                        through it.
                    </Typography>
                </Box>
            ) : (
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: 1 }}>
                    {live.map((run) => (
                        <RunLine
                            key={run.id}
                            run={run}
                            agentsById={agentsById}
                            now={now}
                            reduceMotion={reduceMotion}
                        />
                    ))}
                </Box>
            )}

            {(queued.length > 0 || unassigned > 0) && (
                <Typography
                    sx={{
                        mt: 4,
                        pt: 4,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {queued.length > 0 && (
                        <>
                            Up next:{' '}
                            {queued.map((e, i) => (
                                <Box component="span" key={e.workflow_id}>
                                    {i > 0 && ', '}
                                    <Box
                                        component="span"
                                        sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}
                                    >
                                        {e.count}
                                    </Box>{' '}
                                    in {e.workflow_name}
                                </Box>
                            ))}
                            .{' '}
                        </>
                    )}
                    {unassigned > 0 &&
                        `${unassigned} ready ${unassigned === 1 ? 'task has' : 'tasks have'} no workflow.`}
                </Typography>
            )}
        </Paper>
    );
}
