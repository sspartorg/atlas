import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IAgent, IAgentMemory } from '@atlas/shared';
import { useRegenerateAgentMemory, useSetAgentMemory } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { EditableMarkdownCard } from '../../components/EditableMarkdownCard.js';
import { relativeTime } from './agentViewModel.js';
import { api } from '../../api/api.js';

interface Props {
    agent: IAgent;
    memory: IAgentMemory;
}

function slug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export function MemoryTabContent({ agent, memory }: Props) {
    const toast = useToast();
    const setMemory = useSetAgentMemory();
    const regenerate = useRegenerateAgentMemory();

    const fileName = useMemo(() => `${slug(agent.name)}.memory.md`, [agent.name]);

    const updatedLabel = relativeTime(memory.updated_at);
    const sourceLabel = memory.source === 'manual-edit' ? 'Manual edit' : 'AI-generated';

    async function handleSave(next: string) {
        if (next === memory.body_md) return;
        await new Promise<void>((resolve, reject) => {
            setMemory.mutate(
                { id: agent.id, body_md: next },
                {
                    onSuccess: (saved) => {
                        toast.show({ message: `Saved as v${saved.version}` });
                        resolve();
                    },
                    onError: (e) => reject(e),
                }
            );
        });
    }

    function handleRegenerate() {
        regenerate.mutate(agent.id, {
            onSuccess: (next) => {
                toast.show({ message: `Regenerated memory · v${next.version}` });
            },
            onError: (e) => {
                toast.show({
                    message: 'Regenerate failed',
                    detail: (e as Error).message,
                });
            },
        });
    }

    return (
        <Box>
            <Box
                sx={{
                    px: 2,
                    py: 1.5,
                    mb: 3,
                    borderRadius: '8px',
                    background: 'rgba(0, 122, 201, 0.06)',
                    border: `1px solid rgba(0, 122, 201, 0.18)`,
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'flex-start',
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{
                        fontSize: 18,
                        color: ATLAS_PALETTE.brandBlue,
                        mt: '2px',
                        fontVariationSettings: "'FILL' 1",
                    }}
                >
                    auto_awesome
                </Box>
                <Box>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.brandBlue,
                            mb: 0.5,
                        }}
                    >
                        Procedural memory — course corrections only.
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate70 }}>
                        The agent auto-writes this <code>memory.md</code> after each run by
                        reflecting on what went wrong and what to do differently next time. You can
                        edit it directly — your edits are kept.
                    </Typography>
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    mb: 2,
                    flexWrap: 'wrap',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {sourceLabel}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                        · updated {updatedLabel}
                    </Typography>
                    {memory.last_run_id ? (
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate60,
                            }}
                        >
                            · last run {memory.last_run_id.slice(0, 8)}
                        </Typography>
                    ) : null}
                </Box>

                <Button
                    variant="outlined"
                    onClick={handleRegenerate}
                    disabled={regenerate.isPending}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{
                                fontSize: 18,
                                animation: regenerate.isPending ? 'mem-spin 1s linear infinite' : 'none',
                                '@keyframes mem-spin': {
                                    from: { transform: 'rotate(0deg)' },
                                    to: { transform: 'rotate(360deg)' },
                                },
                            }}
                        >
                            refresh
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        fontSize: 13,
                        color: ATLAS_PALETTE.brandBlue,
                        borderColor: ATLAS_PALETTE.slate12,
                        bgcolor: ATLAS_PALETTE.white,
                        px: 2,
                        py: 0.75,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                            bgcolor: 'rgba(0, 122, 201, 0.04)',
                        },
                    }}
                >
                    {regenerate.isPending ? 'Regenerating…' : 'Regenerate from runs'}
                </Button>
            </Box>

            <RegenerationHistory agentId={agent.id} />

            <EditableMarkdownCard
                title={fileName}
                value={memory.body_md}
                placeholder="Course corrections from past runs will appear here. The agent rewrites this file after each run."
                emptyHint="No memory yet. Click 'Regenerate from runs' to bootstrap it from recent runs."
                minRows={12}
                saving={setMemory.isPending}
                onSave={handleSave}
                meta={
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate60,
                            }}
                        >
                            version {memory.version}.0
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40 }}>·</Typography>
                        <Box
                            sx={{
                                px: 1,
                                py: '2px',
                                borderRadius: '4px',
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                background:
                                    memory.source === 'ai-generated'
                                        ? 'rgba(49, 171, 70, 0.12)'
                                        : 'rgba(0, 122, 201, 0.12)',
                                color:
                                    memory.source === 'ai-generated'
                                        ? ATLAS_PALETTE.green
                                        : ATLAS_PALETTE.brandBlue,
                            }}
                        >
                            {memory.source === 'ai-generated' ? 'AI-GEN' : 'MANUAL'}
                        </Box>
                    </Box>
                }
            />
        </Box>
    );
}

// Theme 08 — regeneration audit history. One row per regen with the
// trigger label + version delta + char-diff metric. SSE invalidation
// keeps it live as new regenerations land via cadence / high-signal /
// manual / mcp_update paths.
function RegenerationHistory({ agentId }: { agentId: string }) {
    const { data } = useQuery({
        queryKey: ['agent-memory-history', agentId],
        queryFn: () => api.agents.getMemoryHistory(agentId, 10),
    });
    if (!data || data.length === 0) return null;
    const triggerColor: Record<string, string> = {
        manual: ATLAS_PALETTE.brandBlue,
        cadence: ATLAS_PALETTE.green,
        high_signal: '#D97706',
        mcp_update: ATLAS_PALETTE.slate70,
    };
    return (
        <Box sx={{ mb: 3 }}>
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    mb: 1.5,
                }}
            >
                Regeneration history
            </Typography>
            <Box
                sx={{
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    borderRadius: '8px',
                    bgcolor: ATLAS_PALETTE.white,
                    overflow: 'hidden',
                }}
            >
                {data.map((row, idx) => (
                    <Box
                        key={row.id}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            px: 2,
                            py: 1,
                            borderBottom:
                                idx < data.length - 1
                                    ? `1px solid ${ATLAS_PALETTE.slate12}`
                                    : 'none',
                            fontSize: 12.5,
                        }}
                    >
                        <Box
                            sx={{
                                px: 1,
                                py: '2px',
                                borderRadius: '4px',
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                bgcolor: `${triggerColor[row.trigger] ?? ATLAS_PALETTE.slate60}1f`,
                                color: triggerColor[row.trigger] ?? ATLAS_PALETTE.slate70,
                                minWidth: 76,
                                textAlign: 'center',
                            }}
                        >
                            {row.trigger.replace('_', ' ')}
                        </Box>
                        {row.boundary_flags.length > 0 ? (
                            <Tooltip
                                arrow
                                title={`Boundary violations detected: ${row.boundary_flags.join(', ')}. Memory was persisted; soft filter — review and edit the body if these are product-specific facts.`}
                            >
                                <Box
                                    sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        px: 1,
                                        py: '2px',
                                        borderRadius: '4px',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: '0.06em',
                                        textTransform: 'uppercase',
                                        bgcolor: 'rgba(217, 119, 6, 0.14)',
                                        color: '#B45309',
                                        cursor: 'help',
                                    }}
                                >
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}
                                    >
                                        warning
                                    </Box>
                                    boundary
                                </Box>
                            </Tooltip>
                        ) : null}
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate70,
                            }}
                        >
                            v{row.prev_version} → v{row.new_version}
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.green,
                            }}
                        >
                            +{row.chars_added}
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.error ?? '#dc2626',
                            }}
                        >
                            −{row.chars_removed}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                            {relativeTime(row.created_at)}
                        </Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
