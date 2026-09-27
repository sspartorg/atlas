import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { FleetAgentRow, FleetDelivery, FleetWindowDays } from '../api/types.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { EmptyState } from '../components/EmptyState.js';
import { KpiTile } from '../components/KpiTile.js';
import { TrendSparkline } from '../components/TrendSparkline.js';
import { useFleetPerformance } from '../hooks/useAgentTests.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { formatCostUsd } from '../utils/formatCost.js';
import { formatSpan } from '../utils/time.js';
import { formatDate } from '../utils/time.js';
import { OUTCOMES, OutcomeBar } from './agents/PerformanceTabContent.js';

// Fleet performance — every agent side by side, and what the fleet delivered.
//
// **A comparison, not a leaderboard.** ADR 0023 rules out ranking agents on
// first-attempt success: a reviewer whose job is to send work back would sort
// to the bottom of any such table, and the page would recommend culling the
// best reviewer in the fleet. So rows come back sorted by name, there is no
// pass rate anywhere, and "Sent back" wears the same blue it wears on the
// agent's own tab — never the error colour.
//
// The delivery tiles are the fleet's outcome rather than its behaviour. The
// one that could not be computed before migration 024 (Owner interventions)
// says when its series starts instead of passing a partial count off as whole.

const WINDOWS: FleetWindowDays[] = [30, 90];

function secs(v: number | null): string {
    return v === null ? '—' : v < 60 ? `${Math.round(v)}s` : `${Math.round(v / 60)}m`;
}


function DeliveryTiles({ d }: { d: FleetDelivery }) {
    const iv = d.interventions;
    return (
        <Box
            sx={{
                display: 'grid',
                gap: 3,
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
                mb: 5,
            }}
        >
            <KpiTile
                label="PRs merged"
                dotColor={ATLAS_PALETTE.success}
                value={<Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>{d.prs_merged}</Box>}
                caption={`of ${d.prs_opened} opened`}
                captionTitle="Merged as last checked on GitHub. Agent-test Tasks are not counted."
            />
            <KpiTile
                label="Cost per merged Task"
                dotColor={ATLAS_PALETTE.brandBlue}
                value={d.cost_per_merged_task_usd === null ? '—' : formatCostUsd(d.cost_per_merged_task_usd)}
                caption={`${d.tasks_merged} delivered · every step, failed ones too`}
                captionTitle="What the delivered Tasks spent — every step of the Task run and its sub-task runs, including failed ones — divided by the Tasks whose every PR merged. A multi-repo Task's PRs count as one delivery."
            />
            <KpiTile
                label="Median time to PR"
                dotColor={ATLAS_PALETTE.slate40}
                value={formatSpan(d.median_s_to_pr)}
                caption="from run start"
            />
            <KpiTile
                label="Owner interventions per Task"
                dotColor={ATLAS_PALETTE.warning}
                value={iv.per_task === null ? '—' : iv.per_task.toFixed(1)}
                caption={
                    iv.since === null
                        ? 'not recorded yet'
                        : `${iv.parked} over ${iv.tasks} Tasks since ${formatDate(iv.since)}`
                }
                captionTitle="Times a Task's run stopped and waited for you. Park history only exists from the date shown; earlier runs are left out rather than counted as zero."
            />
        </Box>
    );
}

function AgentRow({ row, onOpen }: { row: FleetAgentRow; onOpen: () => void }) {
    const fp = row.quality.first_pass;
    return (
        <TableRow hover onClick={onOpen} sx={{ cursor: 'pointer' }}>
            <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '9999px',
                            flexShrink: 0,
                            background: row.accent_color ?? ATLAS_PALETTE.slate40,
                        }}
                    />
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{row.name}</Typography>
                </Box>
            </TableCell>
            <TableCell align="right" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                {row.quality.steps}
            </TableCell>
            <TableCell sx={{ minWidth: 180 }}>
                <Tooltip title={OUTCOMES.map((o) => `${o.label}: ${fp[o.key]}`).join(' · ')}>
                    <Box>
                        <OutcomeBar fp={fp} />
                        <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.5, fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {fp.applied} · {fp.rejected} · {fp.parked}
                        </Typography>
                    </Box>
                </Tooltip>
            </TableCell>
            <TableCell align="right" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                {row.quality.loops}
            </TableCell>
            <TableCell align="right" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                {row.quality.gate_catch}
            </TableCell>
            <TableCell align="right" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                {row.cost.per_step_usd === null ? '—' : formatCostUsd(row.cost.per_step_usd)}
            </TableCell>
            <TableCell align="right" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                {secs(row.latency.p95_s)}
            </TableCell>
            <TableCell>
                <TrendSparkline label={`${row.name} steps by week`} values={row.trend.map((b) => b.steps)} />
            </TableCell>
        </TableRow>
    );
}

const HEAD_SX = {
    fontSize: 11,
    fontWeight: 600,
    color: ATLAS_PALETTE.slate60,
    textTransform: 'uppercase' as const,
    letterSpacing: '.04em',
    whiteSpace: 'nowrap' as const,
};

export function FleetPerformance() {
    const [params, setParams] = useSearchParams();
    const days: FleetWindowDays = params.get('days') === '30' ? 30 : 90;
    const navigate = useNavigate();
    const { data, isLoading, error } = useFleetPerformance(days);

    const nothing = data && data.agents.length === 0 && data.delivery.runs === 0;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Breadcrumb items={[{ label: 'Agents', to: '/agents' }, { label: 'Fleet performance' }]} />

            <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 5 }}>
                <Box>
                    <Typography variant="h1" sx={{ fontSize: '2.25rem', fontWeight: 700, color: ATLAS_PALETTE.slate }}>
                        Fleet performance
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                        Workflow steps and deliveries over the last{' '}
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {days}
                        </Box>{' '}
                        days. Ad-hoc runs are not counted, and agent tests are left out of deliveries.
                    </Typography>
                </Box>
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={days}
                    aria-label="Window"
                    onChange={(_e, v: FleetWindowDays | null) => {
                        if (v !== null) setParams(v === 90 ? {} : { days: String(v) }, { replace: true });
                    }}
                >
                    {WINDOWS.map((w) => (
                        <ToggleButton key={w} value={w} sx={{ textTransform: 'none', px: 2 }}>
                            {w} days
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Box>

            {isLoading ? (
                <Box sx={{ display: 'grid', gap: 3 }}>
                    <Skeleton variant="rounded" height={120} />
                    <Skeleton variant="rounded" height={240} />
                </Box>
            ) : error ? (
                <Alert severity="error">{(error as Error).message}</Alert>
            ) : !data ? null : nothing ? (
                <EmptyState
                    variant="dashed"
                    icon={
                        <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 32 }}>
                            monitoring
                        </Box>
                    }
                    title="Nothing to compare yet"
                    description={`No workflow runs in the last ${days} days. Agents appear here once a workflow step runs.`}
                />
            ) : (
                <>
                    <DeliveryTiles d={data.delivery} />
                    <Box
                        sx={{
                            background: ATLAS_PALETTE.white,
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            borderRadius: '12px',
                            overflowX: 'auto',
                        }}
                    >
                        {data.agents.length === 0 ? (
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, p: 3 }}>
                                No agent took a workflow step in this window.
                            </Typography>
                        ) : (
                            <Table size="small" aria-label="Agents compared">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={HEAD_SX}>Agent</TableCell>
                                        <TableCell sx={HEAD_SX} align="right">
                                            Steps
                                        </TableCell>
                                        <TableCell sx={HEAD_SX}>
                                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                                First attempt
                                                {OUTCOMES.map((o) => (
                                                    <Box key={o.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, textTransform: 'none' }}>
                                                        <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: o.color }} />
                                                        {o.label}
                                                    </Box>
                                                ))}
                                            </Box>
                                        </TableCell>
                                        <TableCell sx={HEAD_SX} align="right">
                                            Loops
                                        </TableCell>
                                        <TableCell sx={HEAD_SX} align="right">
                                            Gate catches
                                        </TableCell>
                                        <TableCell sx={HEAD_SX} align="right">
                                            Cost / step
                                        </TableCell>
                                        <TableCell sx={HEAD_SX} align="right">
                                            p95
                                        </TableCell>
                                        <TableCell sx={HEAD_SX}>Steps by week</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {data.agents.map((row) => (
                                        <AgentRow
                                            key={row.agent_id}
                                            row={row}
                                            onOpen={() => navigate(`/agents/${row.agent_id}?tab=performance`)}
                                        />
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </Box>
                </>
            )}
        </Box>
    );
}
