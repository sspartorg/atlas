import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import type { IAgent } from '@atlas/shared';
import { ProjectTag, StatusChip } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import {
    type SearchHit,
    type SearchType,
    TYPE_LABEL,
    TYPE_ICON,
    TYPE_COLOR,
    groupByType,
} from './searchViewModel.js';
import { getAgentView } from '../agents/agentViewModel.js';

const MONO = '"JetBrains Mono", monospace';

const TYPE_ORDER: SearchType[] = ['epic', 'story', 'bug', 'sub_task', 'sub_bug', 'prompt'];

export type SortKey = 'updated_desc' | 'updated_asc' | 'type';

interface Props {
    hits: SearchHit[];
    agentsById: Map<string, IAgent>;
    projectNameById: Map<string, string>;
    highlightText: string;
    sort: SortKey;
    onSortChange: (s: SortKey) => void;
}

function highlightSubstring(text: string, q: string): React.ReactNode {
    if (!q) return text;
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <Box
                component="mark"
                sx={{
                    background: `${ATLAS_PALETTE.gold}33`,
                    color: ATLAS_PALETTE.slate,
                    px: 0.25,
                    borderRadius: '3px',
                }}
            >
                {text.slice(idx, idx + q.length)}
            </Box>
            {text.slice(idx + q.length)}
        </>
    );
}

export function SearchResults({
    hits,
    agentsById,
    projectNameById,
    highlightText,
    sort,
    onSortChange,
}: Props) {
    const navigate = useNavigate();

    const sortedHits = (() => {
        const arr = [...hits];
        if (sort === 'updated_desc') arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        else if (sort === 'updated_asc')
            arr.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        return arr;
    })();

    const grouped = groupByType(sortedHits);

    function open(h: SearchHit) {
        if (h.type === 'story') navigate(`/issues/stories/${h.id}`);
        else if (h.type === 'epic') navigate(`/epics/${h.id}`);
        else if (h.type === 'prompt') navigate(`/agents/${h.id}`);
        else navigate('/issues');
    }

    return (
        <Box>
            {/* Sort bar */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 3,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}
                    >
                        sort
                    </Box>
                    <Select
                        value={sort}
                        onChange={(e) => onSortChange(e.target.value as SortKey)}
                        variant="standard"
                        disableUnderline
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate,
                            '& .MuiSelect-select': { py: 0 },
                        }}
                    >
                        <MenuItem value="updated_desc" sx={{ fontSize: 13 }}>
                            Updated · newest first
                        </MenuItem>
                        <MenuItem value="updated_asc" sx={{ fontSize: 13 }}>
                            Updated · oldest first
                        </MenuItem>
                        <MenuItem value="type" sx={{ fontSize: 13 }}>
                            Type · grouped
                        </MenuItem>
                    </Select>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {TYPE_ORDER.filter((t) => (grouped.get(t)?.length ?? 0) > 0).map((t) => {
                    const list = grouped.get(t) ?? [];
                    const color = TYPE_COLOR[t];
                    return (
                        <Box
                            key={t}
                            sx={{
                                background: ATLAS_PALETTE.white,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '12px',
                                overflow: 'hidden',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    px: 4,
                                    py: 2,
                                    background: `${color}06`,
                                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 16, color }}
                                    >
                                        {TYPE_ICON[t]}
                                    </Box>
                                    <Typography
                                        sx={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            letterSpacing: '.06em',
                                            textTransform: 'uppercase',
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                    >
                                        {TYPE_LABEL[t]}
                                    </Typography>
                                </Box>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {list.length}
                                </Typography>
                            </Box>

                            {list.map((hit) => {
                                const agent = hit.assignee_agent_id
                                    ? (agentsById.get(hit.assignee_agent_id) ?? null)
                                    : null;
                                const view = agent ? getAgentView(agent) : null;
                                const projectName = hit.project_id
                                    ? projectNameById.get(hit.project_id)
                                    : null;
                                return (
                                    <Box
                                        key={`${hit.type}:${hit.id}`}
                                        onClick={() => open(hit)}
                                        sx={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1,
                                            px: 4,
                                            py: 3,
                                            borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                                            cursor: 'pointer',
                                            transition: 'background 150ms ease',
                                            '&:hover': { background: ATLAS_PALETTE.cloud },
                                        }}
                                    >
                                        {/* Row 1: ticket # + status + assignee */}
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.5,
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    fontFamily: MONO,
                                                    fontSize: 11.5,
                                                    color: ATLAS_PALETTE.brandBlue,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {hit.displayId}
                                            </Typography>
                                            {hit.status && (
                                                <StatusChip status={hit.status} size="sm" />
                                            )}
                                            {agent && (
                                                <Box
                                                    sx={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 1,
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            width: 20,
                                                            height: 20,
                                                            borderRadius: '9999px',
                                                            background: agent.accent_color,
                                                            color: ATLAS_PALETTE.white,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        <Box
                                                            component="span"
                                                            className="material-symbols-rounded"
                                                            sx={{ fontSize: 12 }}
                                                        >
                                                            {view?.glyph ?? 'developer_board'}
                                                        </Box>
                                                    </Box>
                                                    <Typography
                                                        sx={{
                                                            fontSize: 12,
                                                            color: ATLAS_PALETTE.slate,
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {agent.name}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                        {/* Row 2: title + project pill */}
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.5,
                                                minWidth: 0,
                                            }}
                                        >
                                            <Typography
                                                sx={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {highlightSubstring(hit.title, highlightText)}
                                            </Typography>
                                            {projectName && hit.project_id && (
                                                <ProjectTag
                                                    projectId={hit.project_id}
                                                    name={projectName}
                                                    clickable
                                                />
                                            )}
                                        </Box>
                                        {/* Row 3: description (optional, clamped to 2 lines) */}
                                        {hit.description && (
                                            <Typography
                                                sx={{
                                                    fontSize: 12.5,
                                                    color: ATLAS_PALETTE.slate60,
                                                    lineHeight: 1.5,
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {highlightSubstring(
                                                    hit.description,
                                                    highlightText
                                                )}
                                            </Typography>
                                        )}
                                    </Box>
                                );
                            })}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}
