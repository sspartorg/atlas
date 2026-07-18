import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import type { IMarketplaceAgent } from '@atlas/shared';
import { api } from '../api/api.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { AddFromMarketplaceModal } from './marketplace/AddFromMarketplaceModal.js';

const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatSchedule(a: IMarketplaceAgent): string {
    switch (a.schedule_preset) {
        case 'every_n_hours': {
            const h = a.schedule_hours;
            if (h <= 0) return 'On demand';
            return `Every ${h} hour${h === 1 ? '' : 's'}`;
        }
        case 'daily':
            return `Daily at ${a.schedule_time_of_day ?? '—'}`;
        case 'weekly': {
            const days = (a.schedule_weekdays ?? []).map((d) => WEEKDAY_SHORT[d] ?? '?').join('/');
            return `Weekly on ${days || '—'} at ${a.schedule_time_of_day ?? '—'}`;
        }
        case 'monthly':
            return `Monthly on day ${a.schedule_day_of_month ?? '—'} at ${a.schedule_time_of_day ?? '—'}`;
        default:
            return '—';
    }
}

const SECTION_LABEL_SX = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: ATLAS_PALETTE.slate60,
    mb: 2,
} as const;

const KV_ROW_SX = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    py: 1,
    fontSize: 13,
} as const;

function KvRow({ k, v, mono = false }: { k: string; v: string | number; mono?: boolean }) {
    return (
        <Box sx={KV_ROW_SX}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{k}</Typography>
            <Typography
                sx={{
                    fontSize: 12,
                    fontFamily: mono ? '"JetBrains Mono", monospace' : undefined,
                    color: ATLAS_PALETTE.slate,
                }}
            >
                {String(v)}
            </Typography>
        </Box>
    );
}

function BoolRow({ k, v }: { k: string; v: boolean }) {
    return (
        <Box sx={KV_ROW_SX}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{k}</Typography>
            <Typography
                sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: v ? ATLAS_PALETTE.green : ATLAS_PALETTE.slate60,
                }}
            >
                {v ? '✓' : '—'}
            </Typography>
        </Box>
    );
}

export function MarketplaceAgentDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();
    useSetPageTitle('Marketplace agent');

    const full = useQuery({
        queryKey: ['marketplace', 'full', id],
        queryFn: () => api.marketplace.get(id!),
        enabled: !!id,
    });

    // Single list fetch (cached) — we look the row up by id client-side.
    // The search endpoint does NOT match `q` against the catalog id, so we
    // fetch the full list and filter in memory.
    const summary = useQuery({
        queryKey: ['marketplace', 'list', 'detail'],
        queryFn: () => api.marketplace.list({ limit: 100 }),
        staleTime: 30_000,
    });
    const summaryRow = summary.data?.find((a) => a.id === id);

    const [addOpen, setAddOpen] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [slugTaken, setSlugTaken] = useState<
        { conflictingId: string; suggestedId: string } | null
    >(null);

    const handleInstall = async (slug: string) => {
        if (!id) return;
        setInstalling(true);
        try {
            const installed = await api.marketplace.install(id, { agent_id: slug });
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            setAddOpen(false);
            setSlugTaken(null);
            toast.show({ message: `Installed ${full.data?.agent.name ?? installed.id}` });
            navigate(`/agents/${installed.id}`);
        } catch (err) {
            const details = (err as { details?: { conflicting_id?: string; suggested_id?: string } })
                ?.details;
            if (details?.conflicting_id && details?.suggested_id) {
                setSlugTaken({
                    conflictingId: details.conflicting_id,
                    suggestedId: details.suggested_id,
                });
            } else {
                throw err;
            }
        } finally {
            setInstalling(false);
        }
    };

    const closeAdd = () => {
        if (installing) return;
        setAddOpen(false);
        setSlugTaken(null);
    };
    const openAdd = () => {
        setSlugTaken(null);
        setAddOpen(true);
    };

    if (full.isLoading || !id) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Skeleton variant="rectangular" height={48} sx={{ mb: 4 }} />
                <Skeleton variant="rectangular" height={300} />
            </Box>
        );
    }
    if (full.isError || !full.data) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ color: ATLAS_PALETTE.error }}>
                    Marketplace agent not found.
                </Typography>
                <Button onClick={() => navigate('/agents/marketplace')} sx={{ mt: 2 }}>
                    Back to marketplace
                </Button>
            </Box>
        );
    }

    const { agent, handoff_rules, checklists } = full.data;
    const isInstalled = summaryRow?.is_installed ?? false;
    const hasUpgrade = summaryRow?.upgrade_available ?? false;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Button
                startIcon={<ArrowBackRounded sx={{ fontSize: 18 }} />}
                onClick={() => navigate('/agents/marketplace')}
                sx={{ textTransform: 'none', mb: 3, color: ATLAS_PALETTE.slate60 }}
            >
                Marketplace
            </Button>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'auto minmax(0, 1fr)', sm: 'auto minmax(0, 1fr) auto' },
                    gridTemplateAreas: {
                        xs: `"icon name" "buttons buttons"`,
                        sm: 'unset',
                    },
                    columnGap: { xs: 2, sm: 4 },
                    rowGap: { xs: 2.5, sm: 0 },
                    alignItems: 'flex-start',
                    mb: 5,
                }}
            >
                <Box
                    sx={{
                        gridArea: { xs: 'icon', sm: 'auto' },
                        width: 56,
                        height: 56,
                        borderRadius: 2,
                        bgcolor: `${agent.accent_color}1A`,
                        color: agent.accent_color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}
                    >
                        {agent.glyph || 'smart_toy'}
                    </Box>
                </Box>
                <Box sx={{ gridArea: { xs: 'name', sm: 'auto' }, minWidth: 0 }}>
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: { xs: '1.5rem', sm: '2rem' },
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            mb: 1,
                            wordBreak: 'break-word',
                        }}
                    >
                        {agent.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip
                            size="small"
                            label={`v${agent.version}`}
                            sx={{ fontFamily: '"JetBrains Mono", monospace' }}
                        />
                        <Chip size="small" label={agent.category} />
                        <Chip size="small" label={agent.kind_slug} variant="outlined" />
                        <Chip size="small" label={agent.cli} variant="outlined" />
                        <Chip size="small" label={agent.model} variant="outlined" />
                    </Box>
                </Box>
                <Box
                    sx={{
                        gridArea: { xs: 'buttons', sm: 'auto' },
                        display: 'flex',
                        gap: 1.5,
                        flexWrap: 'wrap',
                        justifyContent: { xs: 'flex-end', sm: 'flex-start' },
                    }}
                >
                    <Button
                        startIcon={<DownloadRounded sx={{ fontSize: 18 }} />}
                        href={api.marketplace.exportZipUrl(agent.id)}
                        sx={{ textTransform: 'none' }}
                    >
                        Export
                    </Button>
                    {!isInstalled ? (
                        <Button
                            variant="contained"
                            onClick={openAdd}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                bgcolor: ATLAS_PALETTE.green,
                                boxShadow: 'none',
                                '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                            }}
                        >
                            Add to my agents
                        </Button>
                    ) : hasUpgrade ? (
                        <Button
                            variant="contained"
                            color="warning"
                            onClick={() =>
                                navigate(`/agents/${summaryRow?.installed_agent_id ?? agent.id}`)
                            }
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Review upgrade
                        </Button>
                    ) : (
                        <Button
                            variant="outlined"
                            onClick={() =>
                                navigate(`/agents/${summaryRow?.installed_agent_id ?? agent.id}`)
                            }
                            sx={{ textTransform: 'none' }}
                        >
                            Open installed agent
                        </Button>
                    )}
                </Box>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 4 }}>
                <Box>
                    {agent.summary && (
                        <Box sx={{ mb: 4 }}>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: ATLAS_PALETTE.slate60,
                                    mb: 1,
                                }}
                            >
                                Summary
                            </Typography>
                            <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate70 }}>
                                {agent.summary}
                            </Typography>
                        </Box>
                    )}
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1,
                            }}
                        >
                            Prompt
                        </Typography>
                        <Box
                            sx={{
                                p: 3,
                                borderRadius: 1.5,
                                border: `1px solid ${ATLAS_PALETTE.slate06}`,
                                bgcolor: ATLAS_PALETTE.cloud,
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 12,
                                lineHeight: 1.6,
                                whiteSpace: 'pre-wrap',
                                maxHeight: 480,
                                overflow: 'auto',
                            }}
                        >
                            {agent.prompt_md}
                        </Box>
                    </Box>

                    {/* All settings + flags below are part of the agent row
                        copied verbatim on install. Surface them here so the
                        user knows exactly what they're getting before clicking
                        Add. Layout is a two-column 50/50 grid on md+, single
                        column on mobile. */}
                    <Box
                        sx={{
                            mt: 5,
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                            gap: 4,
                        }}
                    >
                        <Box>
                            <Typography sx={SECTION_LABEL_SX}>Runtime</Typography>
                            <KvRow k="status" v={agent.status} />
                            {agent.framework && <KvRow k="framework" v={agent.framework} />}
                            <KvRow k="role_id" v={agent.role_id ?? '—'} />
                            {agent.designation && <KvRow k="designation" v={agent.designation} />}
                            <KvRow k="max_rounds" v={agent.max_rounds} />
                            <KvRow k="concurrent_runs" v={agent.concurrent_runs} />
                            <KvRow k="memory_cadence" v={agent.memory_cadence} />
                        </Box>
                        <Box>
                            <Typography sx={SECTION_LABEL_SX}>Schedule</Typography>
                            <KvRow k="preset" v={agent.schedule_preset} />
                            <KvRow k="cadence" v={formatSchedule(agent)} />
                            {agent.cron_expr && (
                                <KvRow k="cron_expr" v={agent.cron_expr} mono />
                            )}
                        </Box>
                        <Box>
                            <Typography sx={SECTION_LABEL_SX}>Flags</Typography>
                            <BoolRow k="requires_item" v={agent.requires_item} />
                            <BoolRow k="requires_worktree" v={agent.requires_worktree} />
                            <BoolRow k="push_code" v={agent.push_code} />
                            <BoolRow k="raises_pr" v={agent.raises_pr} />
                        </Box>
                        {Object.keys(agent.settings_json ?? {}).length > 0 && (
                            <Box>
                                <Typography sx={SECTION_LABEL_SX}>Custom settings</Typography>
                                <Box
                                    sx={{
                                        p: 2.5,
                                        borderRadius: 1.5,
                                        border: `1px solid ${ATLAS_PALETTE.slate06}`,
                                        bgcolor: ATLAS_PALETTE.cloud,
                                        fontFamily: '"JetBrains Mono", monospace',
                                        fontSize: 12,
                                        lineHeight: 1.55,
                                        whiteSpace: 'pre-wrap',
                                        maxHeight: 280,
                                        overflow: 'auto',
                                    }}
                                >
                                    {JSON.stringify(agent.settings_json, null, 2)}
                                </Box>
                            </Box>
                        )}
                    </Box>

                    {agent.handoff_prompt_md && (
                        <Box sx={{ mt: 4 }}>
                            <Typography sx={SECTION_LABEL_SX}>Handoff prompt</Typography>
                            <Box
                                sx={{
                                    p: 3,
                                    borderRadius: 1.5,
                                    border: `1px solid ${ATLAS_PALETTE.slate06}`,
                                    bgcolor: ATLAS_PALETTE.cloud,
                                    fontFamily: '"JetBrains Mono", monospace',
                                    fontSize: 12,
                                    lineHeight: 1.6,
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: 240,
                                    overflow: 'auto',
                                }}
                            >
                                {agent.handoff_prompt_md}
                            </Box>
                        </Box>
                    )}
                </Box>
                <Box>
                    <Box sx={{ mb: 4 }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 2,
                            }}
                        >
                            Handoff rules
                        </Typography>
                        {handoff_rules.length === 0 ? (
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                None.
                            </Typography>
                        ) : (
                            handoff_rules.map((r, i) => (
                                <Box
                                    key={i}
                                    sx={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        py: 1,
                                        fontSize: 13,
                                        borderBottom:
                                            i === handoff_rules.length - 1
                                                ? 'none'
                                                : `1px solid ${ATLAS_PALETTE.slate06}`,
                                    }}
                                >
                                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                        {r.kind}
                                    </Typography>
                                    <Typography sx={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
                                        → {r.target_agent_id} ({r.status})
                                    </Typography>
                                </Box>
                            ))
                        )}
                    </Box>
                    <Divider sx={{ mb: 3 }} />
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 2,
                            }}
                        >
                            Pre-handoff checklist
                        </Typography>
                        {checklists.length === 0 ? (
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                None.
                            </Typography>
                        ) : (
                            <Box component="ol" sx={{ pl: 4, m: 0 }}>
                                {checklists.map((c, i) => (
                                    <Box
                                        component="li"
                                        key={i}
                                        sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, mb: 1 }}
                                    >
                                        {c.label}
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>

            {summaryRow && (
                <AddFromMarketplaceModal
                    open={addOpen}
                    onClose={closeAdd}
                    agent={summaryRow}
                    installing={installing}
                    onConfirm={handleInstall}
                    slugTaken={slugTaken}
                />
            )}
        </Box>
    );
}
