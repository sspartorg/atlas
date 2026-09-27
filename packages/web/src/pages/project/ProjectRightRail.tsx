import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import type { IAgent } from '@atlas/shared';
import { InfoPanel, InfoRow, AgentChip } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { useProjectHealth } from '../../hooks/useProjects.js';
import { formatSpan } from '../../utils/time.js';

interface Props {
    projectId: string;
    activeAgents: IAgent[];
    guardrailsMd: string;
    onEditGuardrails?: () => void;
}

const MONO = '"JetBrains Mono", monospace';

function MonoValue({ children }: { children: React.ReactNode }) {
    return (
        <Typography
            sx={{
                fontSize: 12.5,
                color: ATLAS_PALETTE.slate,
                fontFamily: MONO,
                fontWeight: 500,
            }}
        >
            {children}
        </Typography>
    );
}

/** "3 of 5", or a dash when there is nothing to count yet. */
function ofTotal(part: number, total: number): string {
    return total === 0 ? '—' : `${part} of ${total}`;
}

// The same delivery maths as the fleet page (`agent-scorecard.ts`), scoped to
// this project over 30 days. Counts carry their denominators and nothing is a
// percentage: a spec the Architect Reviewer sent back is the reviewer doing
// its job (ADR 0023), not a failure to rank.
function HealthPanel({ projectId }: { projectId: string }) {
    const { data, isLoading, error } = useProjectHealth(projectId);
    const caption = error
        ? `Could not load: ${error.message}`
        : !data
          ? ''
          : data.runs === 0
            ? 'No workflow runs in the last 30 days.'
            : `From ${data.runs} workflow run${data.runs === 1 ? '' : 's'} started in the last 30 days.`;
    const value = (text: string) => <MonoValue>{isLoading || !data ? '—' : text}</MonoValue>;

    return (
        <InfoPanel label="Health · 30 d">
            <InfoRow label="PRs merged">{value(ofTotal(data?.prs_merged ?? 0, data?.prs_opened ?? 0))}</InfoRow>
            <InfoRow label="Specs accepted first try">
                {value(ofTotal(data?.specs.accepted_first_try ?? 0, data?.specs.reviewed ?? 0))}
            </InfoRow>
            <InfoRow label="Median time to PR">{value(formatSpan(data?.median_s_to_pr ?? null))}</InfoRow>
            <InfoRow label="Tasks that needed you">
                {value(data?.escalations.since === null ? '—' : String(data?.escalations.items ?? 0))}
            </InfoRow>
            {caption && (
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40, mt: 1.5, lineHeight: 1.5 }}>
                    {caption}
                </Typography>
            )}
        </InfoPanel>
    );
}

export const ProjectRightRail = memo(function ProjectRightRail({
    projectId,
    activeAgents,
    guardrailsMd,
    onEditGuardrails,
}: Props) {
    const headingPreview = guardrailsMd
        .split('\n')
        .filter((line) => /^##\s+/.test(line))
        .map((line) => line.trim())
        .join('  ')
        .slice(0, 140);
    const hasGuardrails = guardrailsMd.trim().length > 0;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <HealthPanel projectId={projectId} />

            <InfoPanel
                label="Active agents"
                headerRight={
                    <Box
                        component={RouterLink}
                        to="/agents"
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.brandBlue,
                            textDecoration: 'none',
                            '&:hover': { textDecoration: 'underline' },
                        }}
                    >
                        All →
                    </Box>
                }
            >
                {activeAgents.length === 0 ? (
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40 }}>
                        No agents assigned to this project yet.
                    </Typography>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {activeAgents.map((w) => (
                            <Box
                                key={w.id}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    // minWidth: 0 lets the AgentChip's inner
                                    // ellipsis fire when name + designation
                                    // would otherwise push the row past the
                                    // rail. Without this, the chip's
                                    // intrinsic content width wins and the
                                    // panel scrolls horizontally.
                                    minWidth: 0,
                                }}
                            >
                                <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                    <AgentChip agent={w} size="sm" showName layout="stacked" />
                                </Box>
                                <Typography
                                    sx={{
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate40,
                                        fontFamily: MONO,
                                        flexShrink: 0,
                                    }}
                                >
                                    idle
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                )}
            </InfoPanel>

            <InfoPanel
                label="Guard-rails"
                headerRight={
                    <Box
                        component="button"
                        type="button"
                        onClick={onEditGuardrails}
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.brandBlue,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            '&:hover': { textDecoration: 'underline' },
                            '&:focus-visible': {
                                outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                                outlineOffset: 2,
                            },
                        }}
                    >
                        Edit →
                    </Box>
                }
            >
                <Typography
                    sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate80, lineHeight: 1.6, mb: 1.5 }}
                >
                    Single markdown file applied to every agent run inside this project.
                </Typography>
                {!hasGuardrails ? (
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}
                    >
                        No rules set yet.
                    </Typography>
                ) : headingPreview ? (
                    <Typography
                        sx={{
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate60,
                            fontFamily: MONO,
                            background: ATLAS_PALETTE.slate06,
                            borderRadius: '6px',
                            p: 2,
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.6,
                        }}
                    >
                        {headingPreview}…
                    </Typography>
                ) : (
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, fontStyle: 'italic' }}
                    >
                        Editor open in the Guard-rails tab.
                    </Typography>
                )}
            </InfoPanel>
        </Box>
    );
});
