import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { api } from '../api/api.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { MarketplaceAgentCard } from './marketplace/MarketplaceAgentCard.js';
import { BulkInstallBar } from './marketplace/BulkInstallBar.js';
import { runBulkInstall } from './marketplace/bulkInstall.js';
import type { AgentCategory, IMarketplaceAgentSummary } from '@atlas/shared';
import { useToast } from '../hooks/useToast.js';

const CATEGORIES: Array<{ key: AgentCategory | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'software-dev', label: 'Software-dev' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'content', label: 'Content' },
    { key: 'design', label: 'Design' },
];

export function Marketplace() {
    useSetPageTitle('Marketplace');
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();

    const [query, setQuery] = useState('');
    const [category, setCategory] = useState<AgentCategory | 'all'>('all');
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [busy, setBusy] = useState(false);

    const marketplace = useQuery({
        queryKey: ['marketplace', 'list', query, category],
        queryFn: () =>
            api.marketplace.list({
                ...(query ? { q: query } : {}),
                ...(category !== 'all' ? { category } : {}),
                limit: 100,
            }),
    });

    const grouped = useMemo(() => {
        const byCategory = new Map<AgentCategory, IMarketplaceAgentSummary[]>();
        for (const a of marketplace.data ?? []) {
            const arr = byCategory.get(a.category) ?? [];
            arr.push(a);
            byCategory.set(a.category, arr);
        }
        return byCategory;
    }, [marketplace.data]);

    // Catalog ids the Owner can still add — the only ones that get a checkbox.
    const installableIds = useMemo(
        () => (marketplace.data ?? []).filter((a) => !a.is_installed).map((a) => a.id),
        [marketplace.data],
    );

    const toggleSelected = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const clearSelected = () => setSelected(new Set());
    const selectAllInstallable = () => setSelected(new Set(installableIds));

    const addSelected = async () => {
        const ids = [...selected];
        if (ids.length === 0) return;
        setBusy(true);
        const outcome = await runBulkInstall(ids, (id, opts) =>
            api.marketplace.install(id, opts ?? {}),
        );
        await queryClient.invalidateQueries({ queryKey: ['agents'] });
        await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
        if (outcome.succeeded.length > 0) {
            const n = outcome.succeeded.length;
            const failNote =
                outcome.failed.length > 0 ? ` · ${outcome.failed.length} couldn't be added` : '';
            toast.show({ message: `Added ${n} agent${n === 1 ? '' : 's'}${failNote}` });
            // Land on the Agents page with everything freshly installed.
            navigate('/agents');
            return;
        }
        // Nothing installed — keep the failed ids selected so the Owner can retry.
        setSelected(new Set(outcome.failed));
        setBusy(false);
        toast.show({ message: "Couldn't add the selected agents. Please try again." });
    };

    const totalCount = marketplace.data?.length ?? 0;
    const upgradeCount =
        marketplace.data?.filter((a) => a.upgrade_available).length ?? 0;
    const subtitle =
        totalCount === 0
            ? 'No catalog agents'
            : upgradeCount > 0
              ? `${totalCount} available · ${upgradeCount} upgrade${upgradeCount === 1 ? '' : 's'} ready`
              : `${totalCount} available`;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box sx={{ mb: 5 }}>
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: '2.25rem',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    Agent Marketplace
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                    {subtitle}
                </Typography>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    mb: 5,
                    flexWrap: 'wrap',
                }}
            >
                <TextField
                    size="small"
                    placeholder="Search marketplace"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    sx={{ minWidth: 280, flex: '0 0 auto' }}
                    InputProps={{
                        startAdornment: (
                            <SearchRounded
                                sx={{ fontSize: 18, mr: 1, color: ATLAS_PALETTE.slate60 }}
                            />
                        ),
                    }}
                />
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    {CATEGORIES.map((c) => (
                        <Chip
                            key={c.key}
                            label={c.label}
                            clickable
                            color={category === c.key ? 'primary' : 'default'}
                            variant={category === c.key ? 'filled' : 'outlined'}
                            onClick={() => setCategory(c.key)}
                            size="small"
                            sx={{ fontWeight: 500 }}
                        />
                    ))}
                </Box>
            </Box>

            {marketplace.isLoading ? (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            md: 'repeat(3, minmax(0, 1fr))',
                            xl: 'repeat(4, minmax(0, 1fr))',
                        },
                        gap: 3,
                    }}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
                    ))}
                </Box>
            ) : marketplace.isError ? (
                <Typography sx={{ color: ATLAS_PALETTE.error }}>
                    Failed to load marketplace.
                </Typography>
            ) : (marketplace.data?.length ?? 0) === 0 ? (
                <Typography sx={{ color: ATLAS_PALETTE.slate60 }}>
                    No marketplace agents match the current filters.
                </Typography>
            ) : (
                Array.from(grouped.entries()).map(([cat, agents]) => (
                    <Box key={cat} sx={{ mb: 6 }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 3,
                            }}
                        >
                            {cat}
                        </Typography>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: {
                                    xs: '1fr',
                                    sm: 'repeat(2, minmax(0, 1fr))',
                                    md: 'repeat(3, minmax(0, 1fr))',
                                    xl: 'repeat(4, minmax(0, 1fr))',
                                },
                                gap: 3,
                            }}
                        >
                            {agents.map((a) => (
                                <MarketplaceAgentCard
                                    key={a.id}
                                    agent={a}
                                    selectable={!a.is_installed}
                                    selected={selected.has(a.id)}
                                    onToggleSelect={() => toggleSelected(a.id)}
                                    onOpen={() => navigate(`/agents/marketplace/${a.id}`)}
                                    onAfterInstall={(installedId) => {
                                        toast.show({ message: `Installed ${a.name}` });
                                        navigate(`/agents/${installedId}`);
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>
                ))
            )}

            <BulkInstallBar
                count={selected.size}
                busy={busy}
                onClear={clearSelected}
                onSelectAll={selectAllInstallable}
                onAdd={addSelected}
            />
        </Box>
    );
}
