import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type {
    AgentStatsByCategory,
    CostSummary,
    TerminalCostSummary,
} from '../../api/types.js';
import { KpiTile } from '../../components/index.js';
import { formatCostUsd, formatTokenCount } from '../../utils/formatCost.js';
import { useLabelColor } from '../../hooks/useLabelColor.js';

interface IKpiStripProps {
    awaitingCount: number;
    projectCount: number;
    stats: AgentStatsByCategory | undefined;
    costSummary30d?: CostSummary | undefined;
    terminalCostSummary30d?: TerminalCostSummary | undefined;
}

function Bold({ children }: { children: React.ReactNode }) {
    return (
        <Box component="span" sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate }}>
            {children}
        </Box>
    );
}

const NBSP = ' ';

export function KpiStrip({
    awaitingCount,
    projectCount,
    stats,
    costSummary30d,
    terminalCostSummary30d,
}: IKpiStripProps) {
    const dev = stats?.['software-dev'] ?? { queued: 0, running: 0 };
    const mkt = stats?.['marketing'] ?? { queued: 0, running: 0 };
    const ct = stats?.['content'] ?? { queued: 0, running: 0 };
    const dsg = stats?.['design'] ?? { queued: 0, running: 0 };

    // Per-category accent rules — Mercury collapsed brand hues, so we draw
    // from the retained polychrome LABEL_COLORS palette for category cues.
    const review = useLabelColor('amber');
    const devColor = useLabelColor('emerald');
    const mktColor = useLabelColor('rose');
    const cdColor = useLabelColor('indigo');
    const costColor = useLabelColor('sky');

    const contentDesign = {
        queued: ct.queued + dsg.queued,
        running: ct.running + dsg.running,
    };

    const projectsWord = projectCount === 1 ? 'project' : 'projects';

    const queuedRunningValue = (q: number, r: number) => (
        <>
            {q}
            {NBSP}/{NBSP}
            {r}
        </>
    );

    const queuedRunningCaption = (q: number, r: number) => (
        <>
            <Bold>{q}</Bold> queued · <Bold>{r}</Bold> running
        </>
    );

    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: {
                    xs: 'minmax(0, 1fr) minmax(0, 1fr)',
                    sm: 'minmax(0, 1fr) minmax(0, 1fr)',
                    lg: 'repeat(5, minmax(0, 1fr))',
                },
                gap: { xs: 3, md: 6 },
            }}
        >
            <KpiTile
                label="Awaiting your review"
                dotColor={review.border}
                value={awaitingCount}
                caption={
                    <>
                        across <Bold>{projectCount}</Bold> {projectsWord}
                    </>
                }
            />
            <KpiTile
                label="Software dev agents"
                dotColor={devColor.border}
                value={queuedRunningValue(dev.queued, dev.running)}
                caption={queuedRunningCaption(dev.queued, dev.running)}
            />
            <KpiTile
                label="Marketing agents"
                dotColor={mktColor.border}
                value={queuedRunningValue(mkt.queued, mkt.running)}
                caption={queuedRunningCaption(mkt.queued, mkt.running)}
            />
            <KpiTile
                label="Content + Design agents"
                dotColor={cdColor.border}
                value={queuedRunningValue(contentDesign.queued, contentDesign.running)}
                caption={queuedRunningCaption(contentDesign.queued, contentDesign.running)}
            />
            <KpiTile
                label={`AI Cost (${new Date().toLocaleString('default', { month: 'long' })})`}
                dotColor={costColor.border}
                value={
                    costSummary30d || terminalCostSummary30d
                        ? formatCostUsd(
                              (costSummary30d?.total_cost_usd ?? 0) +
                                  (terminalCostSummary30d?.total_cost_usd ?? 0),
                          )
                        : '—'
                }
                caption={
                    costSummary30d || terminalCostSummary30d ? (
                        (() => {
                            const runs = costSummary30d?.run_count ?? 0;
                            const sessions = terminalCostSummary30d?.session_count ?? 0;
                            const totalTokens =
                                (costSummary30d?.input_tokens ?? 0) +
                                (costSummary30d?.output_tokens ?? 0) +
                                (costSummary30d?.cache_read_tokens ?? 0) +
                                (terminalCostSummary30d?.input_tokens ?? 0) +
                                (terminalCostSummary30d?.output_tokens ?? 0) +
                                (terminalCostSummary30d?.cache_read_tokens ?? 0);
                            return (
                                <>
                                    <Bold>{runs}</Bold> run{runs === 1 ? '' : 's'} ·{' '}
                                    <Bold>{sessions}</Bold> session{sessions === 1 ? '' : 's'} ·{' '}
                                    <Bold>{formatTokenCount(totalTokens)}</Bold> tokens
                                </>
                            );
                        })()
                    ) : (
                        'No activity yet'
                    )
                }
            />
        </Box>
    );
}
