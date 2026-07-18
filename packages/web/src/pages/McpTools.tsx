import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import type { IToolCatalogGroup } from '@atlas/shared';

const GROUP_LABELS: Record<string, string> = {
    AGENTS: 'Agents',
    ITEMS: 'Items',
    PROJECTS: 'Projects',
    REMINDERS: 'Reminders',
    NOTIFICATIONS: 'Notifications',
    REVIEW: 'Review',
};

function prettyGroupLabel(key: string): string {
    return GROUP_LABELS[key] ?? key.replace(/_/g, ' ').toLowerCase();
}

export function McpTools() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['tool-catalog'],
        queryFn: () => api.toolCatalog.get(),
    });

    const groups: IToolCatalogGroup[] = data?.groups ?? [];
    const totalTools = groups.reduce((sum, g) => sum + g.tools.length, 0);

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Breadcrumb items={[{ label: 'Agents', to: '/agents' }, { label: 'MCP Tools' }]} />

            <Box sx={{ mb: 8 }}>
                <Typography
                    variant="h1"
                    sx={{ fontSize: '2.25rem', fontWeight: 700, color: ATLAS_PALETTE.slate }}
                >
                    MCP Tools
                </Typography>
                <Typography
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}
                >
                    Read-only directory of every tool the Atlas MCP server exposes to agents.
                </Typography>
                {!isLoading && !isError && totalTools > 0 && (
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate40,
                            mt: 2,
                        }}
                    >
                        {totalTools} tools · {groups.length} categories
                    </Typography>
                )}
            </Box>

            {isError && (
                <Box
                    sx={{
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '8px',
                        p: 4,
                        color: ATLAS_PALETTE.error,
                        fontSize: 13,
                    }}
                >
                    Failed to load tool catalog. Try refreshing the page.
                </Box>
            )}

            {isLoading && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[0, 1, 2].map((i) => (
                        <Box key={i}>
                            <Skeleton variant="text" width={140} height={24} sx={{ mb: 2 }} />
                            <Skeleton variant="rectangular" height={56} sx={{ borderRadius: '8px', mb: 1 }} />
                            <Skeleton variant="rectangular" height={56} sx={{ borderRadius: '8px', mb: 1 }} />
                            <Skeleton variant="rectangular" height={56} sx={{ borderRadius: '8px' }} />
                        </Box>
                    ))}
                </Box>
            )}

            {!isLoading && !isError && groups.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {groups.map((group) => (
                        <Box key={group.group_name}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    mb: 4,
                                    pb: 1.5,
                                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        letterSpacing: '0.08em',
                                        textTransform: 'uppercase',
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {prettyGroupLabel(group.group_name)}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate40,
                                    }}
                                >
                                    {group.tools.length}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    bgcolor: ATLAS_PALETTE.white,
                                }}
                            >
                                {group.tools.map((tool, idx) => (
                                    <Box
                                        key={tool.tool_name}
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: {
                                                xs: '1fr',
                                                md: 'minmax(220px, 1fr) 2.5fr',
                                            },
                                            gap: { xs: 0.5, md: 4 },
                                            alignItems: 'baseline',
                                            px: { xs: 2, md: 3 },
                                            py: 2,
                                            borderBottom:
                                                idx === group.tools.length - 1
                                                    ? 'none'
                                                    : `1px solid ${ATLAS_PALETTE.slate06}`,
                                            transition: 'background-color 150ms ease',
                                            '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                                        }}
                                    >
                                        <Typography
                                            sx={{
                                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                                fontSize: 13,
                                                color: ATLAS_PALETTE.slate,
                                                fontWeight: 500,
                                                wordBreak: 'break-word',
                                            }}
                                        >
                                            {tool.tool_name}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                fontSize: 13,
                                                color: ATLAS_PALETTE.slate80,
                                                lineHeight: 1.6,
                                            }}
                                        >
                                            {tool.description}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}

            {!isLoading && !isError && groups.length === 0 && (
                <Box
                    sx={{
                        border: `1px dashed ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '8px',
                        p: 6,
                        textAlign: 'center',
                        color: ATLAS_PALETTE.slate60,
                        fontSize: 13,
                    }}
                >
                    No MCP tools registered.
                </Box>
            )}
        </Box>
    );
}
