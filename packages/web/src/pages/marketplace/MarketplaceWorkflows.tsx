import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { useAgents } from '../../hooks/useAgents.js';
import { usePublishedWorkflows, useWorkflowTemplates } from '../../hooks/useWorkflows.js';
import { useMarketplaceCatalog } from '../../hooks/useMarketplace.js';
import { ATLAS_PALETTE, ELEVATION, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatDate } from '../../utils/time.js';
import { AgentChips } from '../workflows/NewWorkflowDialog.js';
import { INPUT_KIND_LABEL, deliveryLabel, templateAgentIds } from '../workflows/labels.js';

const GRID_SX = {
    display: 'grid',
    gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, minmax(0, 1fr))',
        md: 'repeat(3, minmax(0, 1fr))',
        xl: 'repeat(4, minmax(0, 1fr))',
    },
    gap: 3,
} as const;

/** Catalog agents by id — names and accents for templates' agent chips. */
export function useCatalogAgentsById() {
    const { data: catalog = [] } = useMarketplaceCatalog();
    return useMemo(() => new Map(catalog.map((a) => [a.id, a])), [catalog]);
}

/**
 * Names and accents for a published workflow's agents: yours first (it was
 * built from them), then the catalog's.
 */
export function useKnownAgentsById(): Map<string, Pick<IAgent, 'name' | 'accent_color' | 'cli'>> {
    const catalogById = useCatalogAgentsById();
    const { data: agents = [] } = useAgents();
    return useMemo(
        () => new Map<string, Pick<IAgent, 'name' | 'accent_color' | 'cli'>>([...catalogById, ...agents.map((a) => [a.id, a] as const)]),
        [catalogById, agents],
    );
}

const SECTION_SX = { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: ATLAS_PALETTE.slate60, mb: 3 } as const;

function WorkflowCard({
    name,
    meta,
    description,
    agentIds,
    agentsById,
    publishedAt,
    onOpen,
}: {
    name: string;
    meta: string;
    description: string | null;
    agentIds: string[];
    agentsById: Map<string, Pick<IAgent, 'name' | 'accent_color' | 'cli'>>;
    publishedAt?: string;
    onOpen: () => void;
}) {
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={name}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen();
            }}
            sx={{
                p: 4,
                borderRadius: '12px',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                transition: 'box-shadow 150ms ease, transform 150ms ease',
                '&:hover': { boxShadow: ELEVATION.mid, transform: 'translateY(-1px)' },
                '&:focus-visible': { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: '-2px' },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{
                        fontSize: 20,
                        p: 1.5,
                        borderRadius: '8px',
                        color: ATLAS_PALETTE.accentFg,
                        background: ATLAS_PALETTE.accentSoft,
                    }}
                >
                    account_tree
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{name}</Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{meta}</Typography>
                </Box>
            </Box>
            <Typography
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate70,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                }}
            >
                {description}
            </Typography>
            <AgentChips ids={agentIds} agentsById={agentsById} />
            {publishedAt && (
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 'auto' }}>
                    Published{' '}
                    <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                        {formatDate(publishedAt)}
                    </Box>
                </Typography>
            )}
        </Box>
    );
}

function CardSkeletons() {
    return (
        <Box sx={GRID_SX}>
            {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
            ))}
        </Box>
    );
}

function PublishedWorkflows() {
    const navigate = useNavigate();
    const { data: published = [], isLoading, isError } = usePublishedWorkflows();
    const agentsById = useKnownAgentsById();

    if (isLoading) return <CardSkeletons />;
    if (isError) return <Typography sx={{ color: ATLAS_PALETTE.error }}>Failed to load your published workflows.</Typography>;
    if (published.length === 0) {
        return (
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                Publish a workflow from its builder to list it here.
            </Typography>
        );
    }
    return (
        <Box sx={GRID_SX}>
            {published.map((p) => (
                <WorkflowCard
                    key={p.id}
                    name={p.name}
                    meta={`${INPUT_KIND_LABEL[p.input_kind]} · ${deliveryLabel(p)}`}
                    description={p.description}
                    agentIds={p.agent_ids}
                    agentsById={agentsById}
                    publishedAt={p.published_at}
                    onOpen={() => navigate(`/agents/marketplace/workflows/published/${p.id}`)}
                />
            ))}
        </Box>
    );
}

function StarterWorkflows() {
    const navigate = useNavigate();
    const { data: templates = [], isLoading, isError } = useWorkflowTemplates();
    const agentsById = useCatalogAgentsById();

    if (isLoading) return <CardSkeletons />;
    if (isError) return <Typography sx={{ color: ATLAS_PALETTE.error }}>Failed to load workflows.</Typography>;
    return (
        <Box sx={GRID_SX}>
            {templates.map((t) => (
                <WorkflowCard
                    key={t.id}
                    name={t.name}
                    meta={`${INPUT_KIND_LABEL[t.input_kind]} · ${deliveryLabel(t)}`}
                    description={t.description}
                    agentIds={templateAgentIds(t, templates)}
                    agentsById={agentsById}
                    onOpen={() => navigate(`/agents/marketplace/workflows/${t.id}`)}
                />
            ))}
        </Box>
    );
}

/** The Marketplace's Workflows tab: the shipped starter workflows, then yours. */
export function MarketplaceWorkflows() {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Box component="section" aria-label="Starter workflows">
                <Typography component="h2" sx={SECTION_SX}>
                    Starter workflows
                </Typography>
                <StarterWorkflows />
            </Box>
            <Box component="section" aria-label="Published by you">
                <Typography component="h2" sx={SECTION_SX}>
                    Published by you
                </Typography>
                <PublishedWorkflows />
            </Box>
        </Box>
    );
}
