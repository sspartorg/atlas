import { lazy, Suspense, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Pagination from '@mui/material/Pagination';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    Legend,
} from 'recharts';
import { api } from '../api/api.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { formatCostUsd } from '../utils/formatCost.js';
import {
    Card,
    ChartTitle,
    Eyebrow,
    Hero,
    ITEM_TYPE_COLORS,
    ITEM_TYPE_LABEL,
    MONO,
    MetricMarquee,
} from './analytics/_chrome.js';

// Lazy: keeps the project-level chunk lean and shares the same
// component used by the /analytics page so terminal session
// formatting stays consistent.
const TerminalSessionsCard = lazy(() => import('./analytics/_TerminalSessionsCard.js'));

function fmtRelativeOrDash(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function AnalyticsProject() {
    const { projectId } = useParams<{ projectId: string }>();
    const safeProjectId = projectId ?? '';
    useSetPageTitle('Project cost');

    const [showAll, setShowAll] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);

    const summary = useQuery({
        queryKey: ['analytics-project', safeProjectId],
        queryFn: () => api.analytics.project(safeProjectId),
        enabled: Boolean(safeProjectId),
        staleTime: 30_000,
    });
    const paged = useQuery({
        queryKey: ['analytics-project-epics', safeProjectId, page, limit],
        queryFn: () => api.analytics.projectEpics(safeProjectId, { page, limit }),
        enabled: Boolean(safeProjectId) && showAll,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

    if (!safeProjectId) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate60 }}>
                    No project id in the URL.
                </Typography>
            </Box>
        );
    }

    if (summary.isPending) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
                <Skeleton variant="rounded" height={180} sx={{ mb: 4 }} />
                <Skeleton variant="rounded" height={320} sx={{ mb: 4 }} />
                <Skeleton variant="rounded" height={420} />
            </Box>
        );
    }

    if (summary.isError || !summary.data) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
                <Typography sx={{ color: ATLAS_PALETTE.error }}>
                    Failed to load project analytics: {(summary.error as Error)?.message ?? 'unknown error'}
                </Typography>
            </Box>
        );
    }

    const data = summary.data;
    const byKindPie = data.byKind.filter((k) => k.total_cost_usd > 0);
    const topMax =
        data.topEpics.length > 0
            ? Math.max(...data.topEpics.map((e) => e.totals.total_cost_usd))
            : 0;
    const remainingEpics = Math.max(0, data.epic_count - data.topEpics.length);

    // Terminal aggregates may be absent on older API responses or stale
    // test fixtures — fall through to zero-shaped defaults so the
    // dedicated terminal card just renders its empty state.
    const terminalSummary = data.terminalSummary ?? {
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        session_count: 0,
    };
    const terminalByCli = data.terminalByCli ?? [];
    const topTerminalSessions = data.topTerminalSessions ?? [];

    // Combined spend for the hero — a project funded only by terminal
    // sessions used to show $0 here even though the parent /analytics
    // listing reported the actual cost. The hero now always reflects
    // the same combined number.
    const combinedCost = data.totals.total_cost_usd + terminalSummary.total_cost_usd;
    const sessionCount = terminalSummary.session_count;
    const totalActivity = data.totals.run_count + sessionCount;
    const avgCostPerActivity = totalActivity > 0 ? combinedCost / totalActivity : 0;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
            <Hero
                breadcrumb={
                    <>
                        <Box
                            component={RouterLink}
                            to="/analytics"
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                color: 'rgba(255,255,255,.65)',
                                textDecoration: 'none',
                                letterSpacing: '0.04em',
                                '&:hover': { color: '#FFFFFF' },
                            }}
                        >
                            Analytics
                        </Box>
                        <Typography
                            sx={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,.4)' }}
                        >
                            /
                        </Typography>
                        <Typography
                            sx={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,.85)' }}
                        >
                            {data.project.name}
                        </Typography>
                    </>
                }
                title={data.project.name}
                sub={`${data.epic_count.toLocaleString()} epic${data.epic_count === 1 ? '' : 's'} • ${data.totals.run_count.toLocaleString()} agentic run${data.totals.run_count === 1 ? '' : 's'} • ${sessionCount.toLocaleString()} terminal session${sessionCount === 1 ? '' : 's'}`}
            >
                <MetricMarquee
                    label="Total spend"
                    value={formatCostUsd(combinedCost)}
                    sub={`${formatCostUsd(data.totals.total_cost_usd)} agentic · ${formatCostUsd(terminalSummary.total_cost_usd)} terminal`}
                    accent={'#06B6D4'}
                />
                <MetricMarquee
                    label="Agentic runs"
                    value={data.totals.run_count.toLocaleString()}
                    sub={`${sessionCount.toLocaleString()} terminal session${sessionCount === 1 ? '' : 's'}`}
                    accent={ATLAS_PALETTE.gold}
                />
                <MetricMarquee
                    label="Epics"
                    value={data.epic_count.toLocaleString()}
                    accent={ATLAS_PALETTE.green}
                />
                <MetricMarquee
                    label="Avg cost / activity"
                    value={totalActivity > 0 ? formatCostUsd(avgCostPerActivity) : '—'}
                    sub="blended across runs + sessions"
                    accent={'#F43F5E'}
                />
            </Hero>

            {/* byKind donut */}
            {byKindPie.length > 0 && (
                <Card sx={{ mb: 4 }}>
                    <ChartTitle
                        eyebrow="Spend mix"
                        title="Cost by item type"
                        sub="Rolled-up across every item in the project (epic + descendant story / bug / sub-task / sub-bug)."
                    />
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                            gap: 4,
                            alignItems: 'center',
                        }}
                    >
                        <Box sx={{ height: 240 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={byKindPie}
                                        dataKey="total_cost_usd"
                                        nameKey="type"
                                        innerRadius={56}
                                        outerRadius={92}
                                        paddingAngle={2}
                                        strokeWidth={0}
                                    >
                                        {byKindPie.map((k) => (
                                            <Cell
                                                key={k.type}
                                                fill={
                                                    ITEM_TYPE_COLORS[
                                                        k.type as keyof typeof ITEM_TYPE_COLORS
                                                    ] ?? ATLAS_PALETTE.slate40
                                                }
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(
                                            value: unknown,
                                            _name: unknown,
                                            p: { payload?: { type?: string } },
                                        ): [string, string] => [
                                            formatCostUsd(Number(value ?? 0)),
                                            (p.payload?.type &&
                                                ITEM_TYPE_LABEL[
                                                    p.payload.type as keyof typeof ITEM_TYPE_LABEL
                                                ]) ||
                                                p.payload?.type ||
                                                '',
                                        ]}
                                    />
                                    <Legend
                                        verticalAlign="bottom"
                                        formatter={(t) =>
                                            ITEM_TYPE_LABEL[
                                                t as keyof typeof ITEM_TYPE_LABEL
                                            ] ?? t
                                        }
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {byKindPie.map((k) => (
                                <Box
                                    key={k.type}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: {
                                            xs: '12px minmax(0, 1fr) auto',
                                            sm: '12px 1fr 110px 70px',
                                        },
                                        gridTemplateAreas: {
                                            xs: `"dot label cost" ".   items items"`,
                                            sm: 'unset',
                                        },
                                        columnGap: { xs: 1.5, sm: 2 },
                                        rowGap: { xs: 0.5, sm: 0 },
                                        alignItems: 'center',
                                        py: 1,
                                        borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    }}
                                >
                                    <Box
                                        sx={{
                                            gridArea: { xs: 'dot', sm: 'auto' },
                                            width: 12,
                                            height: 12,
                                            borderRadius: '3px',
                                            background:
                                                ITEM_TYPE_COLORS[
                                                    k.type as keyof typeof ITEM_TYPE_COLORS
                                                ] ?? ATLAS_PALETTE.slate40,
                                        }}
                                    />
                                    <Typography
                                        sx={{
                                            gridArea: { xs: 'label', sm: 'auto' },
                                            fontSize: 13,
                                            color: ATLAS_PALETTE.slate,
                                            fontWeight: 600,
                                            minWidth: 0,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {ITEM_TYPE_LABEL[
                                            k.type as keyof typeof ITEM_TYPE_LABEL
                                        ] ?? k.type}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            gridArea: { xs: 'cost', sm: 'auto' },
                                            fontFamily: MONO,
                                            fontSize: 13,
                                            fontWeight: 700,
                                            textAlign: 'right',
                                            fontVariantNumeric: 'tabular-nums',
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        {formatCostUsd(k.total_cost_usd)}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            gridArea: { xs: 'items', sm: 'auto' },
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                            textAlign: 'right',
                                        }}
                                    >
                                        {k.item_count} item{k.item_count === 1 ? '' : 's'}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Card>
            )}

            {/* Manual terminal sessions — project-scoped. Renders its
                own empty state when no sessions exist for this project,
                so the section is always visible (consistent with the
                page-level /analytics surface). */}
            <Box sx={{ mb: 4 }}>
                <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
                    <TerminalSessionsCard
                        summary={terminalSummary}
                        byCli={terminalByCli}
                        topSessions={topTerminalSessions}
                        monthLabel="this project"
                    />
                </Suspense>
            </Box>

            {/* Top epics ladder */}
            <Card sx={{ mb: 4 }}>
                <ChartTitle
                    eyebrow="Spend by epic"
                    title="Top epics by total cost"
                    sub={
                        remainingEpics > 0
                            ? `Showing top ${data.topEpics.length} of ${data.epic_count} epics — sorted by descendant-rolled cost.`
                            : `${data.epic_count} epic${data.epic_count === 1 ? '' : 's'} total. Click any row to drill into the child items.`
                    }
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {data.topEpics.map((epic) => {
                        const pct =
                            topMax > 0 ? (epic.totals.total_cost_usd / topMax) * 100 : 0;
                        return (
                            <Box
                                key={epic.id}
                                component={RouterLink}
                                to={`/analytics/epic/${epic.id}`}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: {
                                        xs: 'minmax(0, 1fr) auto auto',
                                        sm: '1fr 2fr 110px 90px 90px',
                                    },
                                    gridTemplateAreas: {
                                        xs: `"title title cost" "bar bar bar" ".  runs descendant"`,
                                        sm: 'unset',
                                    },
                                    alignItems: 'center',
                                    columnGap: { xs: 1.5, sm: 3 },
                                    rowGap: { xs: 0.75, sm: 0 },
                                    py: 1.5,
                                    px: 2,
                                    borderRadius: '10px',
                                    textDecoration: 'none',
                                    color: 'inherit',
                                    border: `1px solid transparent`,
                                    transition: 'background 160ms ease, border-color 160ms ease',
                                    '&:hover': {
                                        background: ATLAS_PALETTE.cloud,
                                        borderColor: `color-mix(in srgb, ${'#3B82F6'} 18%, transparent)`,
                                    },
                                }}
                            >
                                <Box sx={{ gridArea: { xs: 'title', sm: 'auto' }, minWidth: 0 }}>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                        title={epic.title}
                                    >
                                        {epic.title}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 10.5,
                                            color: ATLAS_PALETTE.slate60,
                                            mt: 0.25,
                                        }}
                                    >
                                        {epic.id}
                                    </Typography>
                                </Box>
                                <Box
                                    sx={{
                                        gridArea: { xs: 'bar', sm: 'auto' },
                                        position: 'relative',
                                        height: 8,
                                        borderRadius: '999px',
                                        background: `color-mix(in srgb, ${'#3B82F6'} 8%, transparent)`,
                                        overflow: 'hidden',
                                    }}
                                >
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            inset: 0,
                                            width: `${Math.max(2, pct)}%`,
                                            background: `linear-gradient(90deg, ${'#3B82F6'} 0%, ${'#06B6D4'} 100%)`,
                                            borderRadius: '999px',
                                        }}
                                    />
                                </Box>
                                <Typography
                                    sx={{
                                        gridArea: { xs: 'cost', sm: 'auto' },
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        textAlign: 'right',
                                        color: ATLAS_PALETTE.slate,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatCostUsd(epic.totals.total_cost_usd)}
                                </Typography>
                                <Typography
                                    sx={{
                                        gridArea: { xs: 'runs', sm: 'auto' },
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'right',
                                    }}
                                >
                                    {epic.totals.run_count} runs
                                </Typography>
                                <Typography
                                    sx={{
                                        gridArea: { xs: 'descendant', sm: 'auto' },
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'right',
                                    }}
                                >
                                    {epic.descendant_count} child
                                </Typography>
                            </Box>
                        );
                    })}
                    {data.topEpics.length === 0 && (
                        <Typography sx={{ color: ATLAS_PALETTE.slate60, fontSize: 13, py: 2 }}>
                            No epics with cost data yet.
                        </Typography>
                    )}
                </Box>
                {remainingEpics > 0 && !showAll && (
                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                        <Box
                            component="button"
                            onClick={() => setShowAll(true)}
                            sx={{
                                background: 'transparent',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '8px',
                                px: 2.5,
                                py: 1,
                                color: '#3B82F6',
                                fontFamily: MONO,
                                fontSize: 11.5,
                                letterSpacing: '0.04em',
                                cursor: 'pointer',
                                '&:hover': {
                                    background: ATLAS_PALETTE.cloud,
                                    borderColor: `color-mix(in srgb, ${'#3B82F6'} 22%, transparent)`,
                                },
                            }}
                        >
                            View all {data.epic_count} epics
                        </Box>
                    </Box>
                )}
            </Card>

            {/* Paginated epics table */}
            {showAll && (
                <Card>
                    <ChartTitle
                        eyebrow="All epics"
                        title="Full paginated list"
                        sub={`Sorted by cost. ${paged.data?.total ?? data.epic_count} total — showing page ${page} of ${Math.max(1, Math.ceil((paged.data?.total ?? data.epic_count) / limit))}.`}
                    />
                    <Box sx={{ overflowX: 'auto' }}>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '1.5fr 100px 100px 110px 100px',
                            gap: 2,
                            py: 1,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                            mb: 1,
                            minWidth: { xs: 580, sm: 'auto' },
                        }}
                    >
                        {['Title', 'Descendants', 'Runs', 'Total cost', 'Last run'].map((h, i) => (
                            <Eyebrow key={i}>{h}</Eyebrow>
                        ))}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: { xs: 580, sm: 'auto' } }}>
                        {paged.data?.rows.map((row) => (
                            <Box
                                key={row.id}
                                component={RouterLink}
                                to={`/analytics/epic/${row.id}`}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '1.5fr 100px 100px 110px 100px',
                                    gap: 2,
                                    py: 1.25,
                                    px: 1.5,
                                    alignItems: 'center',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    color: 'inherit',
                                    '&:hover': { background: ATLAS_PALETTE.cloud },
                                }}
                            >
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: ATLAS_PALETTE.slate,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                        title={row.title}
                                    >
                                        {row.title}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 10.5,
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                    >
                                        {row.id}
                                    </Typography>
                                </Box>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'right',
                                    }}
                                >
                                    {row.descendant_count}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'right',
                                    }}
                                >
                                    {row.totals.run_count}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        textAlign: 'right',
                                        color: ATLAS_PALETTE.slate,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatCostUsd(row.totals.total_cost_usd)}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                        textAlign: 'right',
                                    }}
                                >
                                    {fmtRelativeOrDash(row.last_run_at)}
                                </Typography>
                            </Box>
                        ))}
                        {paged.isPending && (
                            <Skeleton variant="rounded" height={48} sx={{ my: 0.5 }} />
                        )}
                    </Box>
                    </Box>
                    <Box
                        sx={{
                            mt: 3,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 2,
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                Rows per page
                            </Typography>
                            <Select
                                size="small"
                                value={limit}
                                onChange={(e) => {
                                    setLimit(Number(e.target.value));
                                    setPage(1);
                                }}
                                sx={{ fontSize: 12, height: 32 }}
                            >
                                <MenuItem value={25}>25</MenuItem>
                                <MenuItem value={50}>50</MenuItem>
                                <MenuItem value={100}>100</MenuItem>
                            </Select>
                        </Box>
                        <Pagination
                            count={Math.max(1, Math.ceil((paged.data?.total ?? data.epic_count) / limit))}
                            page={page}
                            onChange={(_e, p) => setPage(p)}
                            size="small"
                            color="primary"
                        />
                    </Box>
                </Card>
            )}
        </Box>
    );
}
