import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import type { IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { AwaitingItem } from '../../api/types.js';
import { KindIcon } from '../../components/KindIcon.js';
import { StatusPill } from './StatusPill.js';

interface IAwaitingYouRowProps {
    row: AwaitingItem;
}

const MONO_FONT = '"JetBrains Mono", monospace';
const OVERDUE_STATUSES = new Set(['waiting_for_info', 'in_review']);


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
    if (diffMin < 60) return `${diffMin} m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} h waiting on you`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} d waiting on you`;
}

export function AwaitingYouRow({ row }: IAwaitingYouRowProps) {
    const navigate = useNavigate();
    const overdue = OVERDUE_STATUSES.has(row.status);
    const duration = relativeDuration(row.updated_at);

    function go() {
        navigate(DETAIL_PATH[row.issue_type](row.id));
    }

    return (
        <Box
            onClick={go}
            sx={{
                display: 'flex',
                // xs: vertical card-style row so the title gets full width
                //     and the status + duration share a tidy footer row.
                // sm+: original two-column horizontal layout.
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                justifyContent: 'space-between',
                gap: { xs: 1.5, sm: 3 },
                py: 2.5,
                px: 3,
                mx: -3,
                minHeight: 72,
                cursor: 'pointer',
                transition: 'background 150ms ease',
                '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                '&:active': { bgcolor: ATLAS_PALETTE.slate06 },
                '&:not(:last-of-type)': { borderBottom: `1px solid ${ATLAS_PALETTE.slate06}` },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, minWidth: 0, flex: 1 }}>
                <Box sx={{ mt: '2px', flexShrink: 0 }}>
                    <KindIcon kind={row.issue_type} size={16} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                        sx={{
                            fontFamily: MONO_FONT,
                            fontSize: '0.6875rem',
                            color: ATLAS_PALETTE.slate60,
                            letterSpacing: '0.02em',
                        }}
                    >
                        {shortId(row.issue_type, row.id)}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 14,
                            color: ATLAS_PALETTE.slate,
                            // Wrap title on mobile (two-line clamp) so the
                            // entire row reads as a self-contained card.
                            // Truncate to a single line on desktop where the
                            // status cluster is on the right.
                            overflow: 'hidden',
                            display: { xs: '-webkit-box', sm: 'block' },
                            WebkitLineClamp: { xs: 2, sm: 'unset' } as never,
                            WebkitBoxOrient: { xs: 'vertical', sm: 'unset' } as never,
                            textOverflow: 'ellipsis',
                            whiteSpace: { xs: 'normal', sm: 'nowrap' },
                            lineHeight: 1.4,
                            mt: 0.5,
                        }}
                    >
                        {row.title}
                    </Typography>
                </Box>
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    // xs: status + duration on one horizontal row, left-aligned
                    //     under the title. sm+: stacked, right-aligned.
                    flexDirection: { xs: 'row', sm: 'column' },
                    alignItems: { xs: 'center', sm: 'flex-end' },
                    justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                    gap: { xs: 2, sm: 1 },
                    flexShrink: 0,
                    pl: { xs: 5, sm: 0 }, // align under the title on mobile
                }}
            >
                <StatusPill status={row.status} />
                {duration && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{
                                fontSize: 14,
                                color: overdue ? ATLAS_PALETTE.orange : ATLAS_PALETTE.slate60,
                            }}
                        >
                            schedule
                        </Box>
                        <Typography
                            sx={{
                                fontFamily: MONO_FONT,
                                fontSize: '0.6875rem',
                                color: overdue ? ATLAS_PALETTE.orange : ATLAS_PALETTE.slate60,
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
