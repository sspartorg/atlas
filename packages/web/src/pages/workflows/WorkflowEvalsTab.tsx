import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

import { api } from '../../api/api.js';
import { useAgentTestBatches, useRunAgentTest } from '../../hooks/useAgentTests.js';
import { useToast } from '../../hooks/useToast.js';
import type { AgentTest, AgentTestBatch, ParkedFixture } from '../../api/types.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { relativeTime } from '../../utils/time.js';

// Workflow evals (ADR 0023 phase 3, ATL-173).
//
// `evals/` measures the whole delivery chain and every part of it is a CLI: a
// manifest path printed to a terminal, a markdown scorecard in a gitignored
// directory, and comparing two runs means opening two files side by side.
//
// The same fixture primitive as an agent test, pointed at a workflow instead of
// one agent — so the expectations, the verdict, the batching and the sampling
// are all the ones already there.
//
// **The parked inbox is not a nicety.** ATL-173: every fixture parks once at PO
// Writer's brainstorm by design, that is ~12 substantive answers across a set,
// and it is the slowest part of the whole exercise — the Owner is the
// bottleneck, not the agents. If those parks are not something to answer in the
// UI, a set run from the UI is worse than the CLI, not better. It also shows
// every park reason together, because two fixtures once escalated on the same
// defect and the two rulings would have contradicted each other: each run only
// ever sees its own branch.

function verdictOf(batch: AgentTestBatch | undefined): { label: string; color: string } {
    if (!batch) return { label: 'never run', color: ATLAS_PALETTE.slate60 };
    if (batch.running > 0) return { label: 'running…', color: ATLAS_PALETTE.slate60 };
    const judged = batch.n_runs - batch.errored;
    if (judged === 0) return { label: 'could not run', color: ATLAS_PALETTE.amber };
    if (batch.flaky) return { label: `${batch.passed}/${judged} passed · flaky`, color: ATLAS_PALETTE.amber };
    return batch.passed === judged
        ? { label: judged > 1 ? `${judged}/${judged} passed` : 'passed', color: ATLAS_PALETTE.greenDark }
        : { label: 'failed', color: ATLAS_PALETTE.red };
}

function ParkedInbox({ parked, workflowId }: { parked: ParkedFixture[]; workflowId: string }) {
    if (parked.length === 0) return null;
    return (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
            <AlertTitle>
                {parked.length} {parked.length === 1 ? 'fixture is' : 'fixtures are'} waiting on you
            </AlertTitle>
            <Typography sx={{ fontSize: 12, mb: 1.5 }}>
                Every fixture parks once by design. Across a set this is the slowest part of the exercise — and the
                answers are visible to each other here, so two of them cannot contradict.
            </Typography>
            <Box sx={{ display: 'grid', gap: 1 }}>
                {parked.map((p) => (
                    <Box key={p.run_id} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, minWidth: 180 }}>{p.test_name}</Typography>
                        {p.parked_node_id && (
                            <Typography
                                sx={{ fontSize: 11, fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate60 }}
                            >
                                {p.parked_node_id}
                            </Typography>
                        )}
                        <Typography sx={{ fontSize: 12, flex: 1, minWidth: 200 }}>
                            {p.park_reason ?? 'No reason recorded.'}
                        </Typography>
                        <Button
                            size="small"
                            component={RouterLink}
                            to={`/workflows/${workflowId}/runs/${p.workflow_run_id}`}
                        >
                            Answer
                        </Button>
                    </Box>
                ))}
            </Box>
        </Alert>
    );
}

function FixtureRow({ fixture }: { fixture: AgentTest }) {
    const { data: batches } = useAgentTestBatches(fixture.id);
    const run = useRunAgentTest();
    const toast = useToast();
    const last = batches?.[0];
    const v = verdictOf(last);

    return (
        <Box sx={{ border: `1px solid ${ATLAS_PALETTE.slate12}`, borderRadius: 1, p: 2, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{fixture.name}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: v.color }}>{v.label}</Typography>
                {last && last.cost_usd > 0 && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {formatCostUsd(last.cost_usd)} · {relativeTime(last.created_at)}
                    </Typography>
                )}
                <Button
                    size="small"
                    variant="outlined"
                    disabled={run.isPending}
                    onClick={() =>
                        run.mutate(
                            { testId: fixture.id },
                            {
                                onSuccess: () => toast.show({ message: 'Eval started' }),
                                onError: (e) => toast.show({ message: (e as Error).message }),
                            },
                        )
                    }
                >
                    Run
                </Button>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                {fixture.item_template.title}
                {fixture.suite ? ` · in "${fixture.suite}"` : ''}
            </Typography>
            {last?.failure_histogram.map((f) => (
                <Typography key={f.failure} sx={{ fontSize: 12, color: ATLAS_PALETTE.red, pl: 0.5, mt: 0.5 }}>
                    • {last.n_runs > 1 ? `${f.count} of ${last.n_runs} runs: ` : ''}
                    {f.failure}
                </Typography>
            ))}
        </Box>
    );
}

export function WorkflowEvalsTab({ workflowId }: { workflowId: string }) {
    const { data: fixtures, isLoading } = useQuery({
        queryKey: ['workflow-evals', workflowId],
        queryFn: () => api.agentTests.forWorkflow(workflowId),
        enabled: Boolean(workflowId),
    });
    const { data: parked = [] } = useQuery({
        queryKey: ['workflow-evals-parked', workflowId],
        queryFn: () => api.agentTests.parked(workflowId),
        enabled: Boolean(workflowId),
        // A run parks mid-flight, so the inbox has to find out without a reload.
        refetchInterval: 15_000,
    });

    if (isLoading) return <CircularProgress size={20} />;

    return (
        <Box>
            <ParkedInbox parked={parked} workflowId={workflowId} />
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                A fixture is an input item, a repo and what should happen. Run one through this whole workflow and it
                is measured end to end — the same primitive the Tests tab runs through a single agent.
            </Typography>
            {(fixtures ?? []).length === 0 ? (
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    No fixtures point at this workflow yet. One run of a delivery chain is dollars and tens of
                    minutes, so they are written deliberately — through the API or MCP, or seeded from the golden set.
                </Typography>
            ) : (
                (fixtures ?? []).map((f) => <FixtureRow key={f.id} fixture={f} />)
            )}
        </Box>
    );
}
