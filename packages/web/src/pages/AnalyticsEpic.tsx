import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Pagination from '@mui/material/Pagination';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
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

type Kind = 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';

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

export function AnalyticsEpic() {
    const { epicId } = useParams<{ epicId: string }>();
    const safeEpicId = epicId ?? '';
    useSetPageTitle('Epic cost');

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [typeFilter, setTypeFilter] = useState<Kind | null>(null);

    const summary = useQuery({
        queryKey: ['analytics-epic', safeEpicId],
        queryFn: () => api.analytics.epic(safeEpicId),
        enabled: Boolean(safeEpicId),
        staleTime: 30_000,
    });
    const children = useQuery({
        queryKey: [
            'analytics-epic-children',
            safeEpicId,
            page,
            limit,
            typeFilter ?? 'all',
        ],
        queryFn: () =>
            api.analytics.epicChildren(safeEpicId, {
                page,
                limit,
                ...(typeFilter ? { type: typeFilter } : {}),
            }),
        enabled: Boolean(safeEpicId),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    });

    if (!safeEpicId) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
                <Typography sx={{ color: ATLAS_PALETTE.slate60 }}>
                    No epic id in the URL.
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
                    Failed to load epic analytics:{' '}
                    {(summary.error as Error)?.message ?? 'unknown error'}
                </Typography>
            </Box>
        );
    }

    const data = summary.data;
    const byKindPie = data.byKind.filter((k) => k.total_cost_usd > 0);
    const totalPages = Math.max(1, Math.ceil((children.data?.total ?? 0) / limit));

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
                        <Box
                            component={RouterLink}
                            to={`/analytics/project/${data.epic.project_id}`}
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                color: 'rgba(255,255,255,.65)',
                                textDecoration: 'none',
                                letterSpacing: '0.04em',
                                '&:hover': { color: '#FFFFFF' },
                            }}
                        >
                            {data.epic.project_name || data.epic.project_id || 'Project'}
                        </Box>
                        <Typography
                            sx={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,.4)' }}
                        >
                            /
                        </Typography>
                        <Typography
                            sx={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,.85)' }}
                        >
                            {data.epic.id}
                        </Typography>
                    </>
                }
                title={data.epic.title}
                sub={`${data.descendant_count.toLocaleString()} child item${data.descendant_count === 1 ? '' : 's'} • ${data.totals.run_count.toLocaleString()} completed runs`}
            >
                <MetricMarquee
                    label="Total cost"
                    value={formatCostUsd(data.totals.total_cost_usd)}
                    accent={'#06B6D4'}
                />
                <MetricMarquee
                    label="Runs"
                    value={data.totals.run_count.toLocaleString()}
                    accent={ATLAS_PALETTE.gold}
                />
                <MetricMarquee
                    label="Descendants"
                    value={data.descendant_count.toLocaleString()}
                    accent={ATLAS_PALETTE.green}
                />
                <MetricMarquee
                    label="Avg cost / run"
                    value={
                        data.totals.run_count > 0
                            ? formatCostUsd(
                                  data.totals.total_cost_usd / data.totals.run_count,
                              )
                            : '—'
                    }
                    accent={'#F43F5E'}
                />
            </Hero>

            {/* Per-kind summary cards */}
            {byKindPie.length > 0 && (
                <Card sx={{ mb: 4 }}>
                    <ChartTitle
                        eyebrow="By item type"
                        title="Cost split across the epic's descendants"
                        sub="Click any type card to filter the items table below."
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
                                                    ITEM_TYPE_COLORS[k.type as Kind] ??
                                                    ATLAS_PALETTE.slate40
                                                }
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(
                                            value: unknown,
                                            _n: unknown,
                                            p: { payload?: { type?: string } },
                                        ): [string, string] => [
                                            formatCostUsd(Number(value ?? 0)),
                                            (p.payload?.type &&
                                                ITEM_TYPE_LABEL[
                                                    p.payload.type as Kind
                                                ]) ||
                                                p.payload?.type ||
                                                '',
                                        ]}
                                    />
                                    <Legend
                                        verticalAlign="bottom"
                                        formatter={(t) => ITEM_TYPE_LABEL[t as Kind] ?? t}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </Box>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                                gap: 2,
                            }}
                        >
                            {byKindPie.map((k) => {
                                const isActive = typeFilter === k.type;
                                return (
                                    <Box
                                        key={k.type}
                                        component="button"
                                        onClick={() => {
                                            setTypeFilter(isActive ? null : (k.type as Kind));
                                            setPage(1);
                                        }}
                                        sx={{
                                            textAlign: 'left',
                                            background: isActive
                                                ? ATLAS_PALETTE.cloud
                                                : ATLAS_PALETTE.white,
                                            border: `1px solid ${isActive ? '#3B82F6' : ATLAS_PALETTE.slate10}`,
                                            borderRadius: '10px',
                                            p: 2,
                                            cursor: 'pointer',
                                            transition: 'all 160ms ease',
                                            '&:hover': {
                                                borderColor: ATLAS_PALETTE.slate30,
                                                background: ATLAS_PALETTE.cloud,
                                            },
                                        }}
                                    >
                                        <Box
                                            sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
                                        >
                                            <Box
                                                sx={{
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: '3px',
                                                    background:
                                                        ITEM_TYPE_COLORS[k.type as Kind] ??
                                                        ATLAS_PALETTE.slate40,
                                                }}
                                            />
                                            <Eyebrow>
                                                {ITEM_TYPE_LABEL[k.type as Kind] ?? k.type}
                                            </Eyebrow>
                                        </Box>
                                        <Typography
                                            sx={{
                                                fontSize: 18,
                                                fontWeight: 700,
                                                color: ATLAS_PALETTE.slate,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {formatCostUsd(k.total_cost_usd)}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                fontFamily: MONO,
                                                fontSize: 11,
                                                color: ATLAS_PALETTE.slate60,
                                                mt: 0.5,
                                            }}
                                        >
                                            {k.item_count} item{k.item_count === 1 ? '' : 's'} • {k.run_count} run
                                            {k.run_count === 1 ? '' : 's'}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                </Card>
            )}

            {/* Paginated children table */}
            <Card>
                <ChartTitle
                    eyebrow="Child items"
                    title="Per-item cost"
                    sub={`Every descendant of this epic. Sorted by cost.${typeFilter ? ` Filtered to ${ITEM_TYPE_LABEL[typeFilter]} only.` : ''}`}
                />
                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    {typeFilter ? (
                        <Chip
                            label={`Showing only: ${ITEM_TYPE_LABEL[typeFilter]}`}
                            onDelete={() => {
                                setTypeFilter(null);
                                setPage(1);
                            }}
                            sx={{
                                background: ATLAS_PALETTE.cloud,
                                color: '#3B82F6',
                                fontFamily: MONO,
                                fontSize: 11,
                            }}
                        />
                    ) : (
                        <Chip
                            label="Showing all kinds"
                            sx={{
                                background: 'transparent',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                color: ATLAS_PALETTE.slate60,
                                fontFamily: MONO,
                                fontSize: 11,
                            }}
                        />
                    )}
                </Box>
                <Box sx={{ overflowX: 'auto' }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: '1.6fr 90px 70px 110px 100px',
                        gap: 2,
                        py: 1,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                        mb: 1,
                        minWidth: { xs: 560, sm: 'auto' },
                    }}
                >
                    {['Title', 'Type', 'Runs', 'Total cost', 'Last run'].map((h, i) => (
                        <Eyebrow key={i}>{h}</Eyebrow>
                    ))}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: { xs: 560, sm: 'auto' } }}>
                    {children.data?.rows.map((row) => (
                        <Box
                            key={row.id}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: '1.6fr 90px 70px 110px 100px',
                                gap: 2,
                                py: 1.25,
                                px: 1.5,
                                alignItems: 'center',
                                borderRadius: '8px',
                                '&:hover': { background: ATLAS_PALETTE.cloud },
                            }}
                        >
                            <Box
                                sx={{
                                    minWidth: 0,
                                    pl: `${Math.max(0, row.depth - 1) * 16}px`,
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
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
                            <Box>
                                <Box
                                    sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        px: 1.25,
                                        py: 0.25,
                                        borderRadius: '999px',
                                        background: `${ITEM_TYPE_COLORS[row.type] ?? ATLAS_PALETTE.slate40}1a`,
                                        color: ITEM_TYPE_COLORS[row.type] ?? ATLAS_PALETTE.slate60,
                                        fontFamily: MONO,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {ITEM_TYPE_LABEL[row.type] ?? row.type}
                                </Box>
                            </Box>
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12,
                                    color: ATLAS_PALETTE.slate60,
                                    textAlign: 'right',
                                }}
                            >
                                {row.run_count}
                            </Typography>
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: ATLAS_PALETTE.slate,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {formatCostUsd(row.total_cost_usd)}
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
                    {children.isPending && (
                        <Skeleton variant="rounded" height={48} sx={{ my: 0.5 }} />
                    )}
                    {!children.isPending && (children.data?.rows.length ?? 0) === 0 && (
                        <Typography
                            sx={{ color: ATLAS_PALETTE.slate60, fontSize: 13, py: 4, textAlign: 'center' }}
                        >
                            No items match the current filter.
                        </Typography>
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
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, ml: 2 }}>
                            {children.data?.total ?? 0} total
                        </Typography>
                    </Box>
                    <Pagination
                        count={totalPages}
                        page={page}
                        onChange={(_e, p) => setPage(p)}
                        size="small"
                        color="primary"
                    />
                </Box>
            </Card>
        </Box>
    );
}
