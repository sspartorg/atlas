import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import type { IAgent, IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { QueueItem } from '../../api/types.js';
import { StatusPill } from './StatusPill.js';

interface IInMotionRowProps {
    row: QueueItem;
    agent: IAgent | undefined;
}

const MONO_FONT = '"JetBrains Mono", monospace';

// Material Symbols glyph by agent name. Agent glyphs aren't stored on IAgent
// (agents are a fixed, seeded set keyed by name), so the mapping lives here.
const GLYPH_BY_AGENT_NAME: Record<string, string> = {
    'PO Writer': 'description',
    'Spec Writer': 'article',
    Coder: 'code',
    'QA Writer': 'bug_report',
    'Digital Marketer': 'campaign',
    'SEO Expert': 'search',
    'Tech Writer': 'menu_book',
    'API Docs Writer': 'api',
    'UI/UX Designer': 'brush',
    Wireframer: 'dashboard_customize',
};

const DETAIL_PATH: Record<IssueType, (id: string) => string> = {
    epic: (id) => `/epics/${id}`,
    story: (id) => `/issues/stories/${id}`,
    bug: (id) => `/issues/bugs/${id}`,
    sub_task: (id) => `/issues/sub-tasks/${id}`,
    sub_bug: (id) => `/issues/sub-bugs/${id}`,
};

function shortId(_type: IssueType, id: string): string {
    return id;
}

function relativeDuration(updatedAt: string): string {
    const diffMs = Date.now() - new Date(updatedAt).getTime();
    if (Number.isNaN(diffMs)) return '';
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin} m running`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} h running`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} d running`;
}

export function InMotionRow({ row, agent }: IInMotionRowProps) {
    const navigate = useNavigate();
    const accent = agent?.accent_color ?? row.accent_color ?? ATLAS_PALETTE.slate;
    const glyph = agent ? (GLYPH_BY_AGENT_NAME[agent.name] ?? 'smart_toy') : 'smart_toy';
    const duration = relativeDuration(row.updated_at);

    return (
        <Box
            onClick={() => navigate(DETAIL_PATH[row.issue_type](row.id))}
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 3,
                py: 2.5,
                px: 3,
                mx: -3,
                minHeight: 72,
                cursor: 'pointer',
                transition: 'background 150ms ease',
                '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                '&:not(:last-of-type)': { borderBottom: `1px solid ${ATLAS_PALETTE.slate06}` },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, minWidth: 0, flex: 1 }}>
                <Box
                    sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '9999px',
                        bgcolor: accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: ATLAS_PALETTE.white,
                        flexShrink: 0,
                        mt: '2px',
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 16, lineHeight: 1 }}
                    >
                        {glyph}
                    </Box>
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <Typography
                            sx={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                            }}
                        >
                            {agent?.name ?? row.agent_name ?? 'Unassigned'}
                        </Typography>
                        <Box
                            component="span"
                            sx={{
                                color: ATLAS_PALETTE.slate40,
                                fontSize: 12,
                                lineHeight: 1,
                                flexShrink: 0,
                            }}
                        >
                            •
                        </Box>
                        <Typography
                            sx={{
                                fontFamily: MONO_FONT,
                                fontSize: '0.6875rem',
                                color: ATLAS_PALETTE.slate60,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {shortId(row.issue_type, row.id)}
                        </Typography>
                    </Box>
                    <Typography
                        sx={{
                            fontSize: 14,
                            color: ATLAS_PALETTE.slate,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            mt: 1,
                        }}
                    >
                        {row.title}
                    </Typography>
                </Box>
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 1,
                    flexShrink: 0,
                }}
            >
                <StatusPill status={row.status} />
                {duration && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 14, color: ATLAS_PALETTE.green }}
                        >
                            schedule
                        </Box>
                        <Typography
                            sx={{
                                fontFamily: MONO_FONT,
                                fontSize: '0.6875rem',
                                color: ATLAS_PALETTE.green,
                            }}
                        >
                            {duration}
                        </Typography>
                    </Box>
                )}
            </Box>
        </Box>
    );
}
