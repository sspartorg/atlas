import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import type { IAgent } from '@atlas/shared';

import {
    useAgentCostEstimate,
    useAgentTestBatches,
    useAgentTests,
    useCreateAgentTest,
    useDeleteAgentTest,
    useRunAgentTest,
} from '../../hooks/useAgentTests.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import type { AgentTest, AgentTestBatch, AgentTestRun } from '../../api/types.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { relativeTime } from '../../utils/time.js';

// Agent tests (ADR 0023).
//
// A customer installing an agent from the marketplace does it on trust, and an
// agent they wrote themselves cannot be qualified at all. This is where that
// stops being true.
//
// A test carries the ITEM the agent should act on rather than a prompt, because
// a prompt cannot exercise the agents Atlas ships — PO Writer refuses anything
// that is not a Task, Coder needs a sub-task with a repo. That is exactly why
// the neighbouring Test Run tab has never been usable as a test.

const VERDICT: Record<AgentTestRun['verdict'], { label: string; color: string }> = {
    passed: { label: 'passed', color: ATLAS_PALETTE.greenDark },
    failed: { label: 'failed', color: ATLAS_PALETTE.red },
    // Not `failed`: the dispatch never ran, which is a broken environment
    // rather than a failing agent (the ADR 0020 distinction).
    errored: { label: 'could not run', color: ATLAS_PALETTE.amber },
    running: { label: 'running…', color: ATLAS_PALETTE.slate60 },
};

const OUTCOMES = [
    { value: '', label: 'Any outcome' },
    { value: 'done', label: 'done — finished the work' },
    { value: 'rejected', label: 'rejected — sent the work back' },
    // First-class, not a fallback: an agent that asks rather than inventing a
    // feature from an unanswerable Task has SUCCEEDED.
    { value: 'asked_question', label: 'asked_question — asked instead of guessing' },
] as const;

/** How many samples one press takes. An agent is stochastic; one is a coin flip. */
const SAMPLE_CHOICES = [1, 3, 5, 10] as const;

/**
 * The verdict, as a sentence rather than a chip.
 *
 * `3/5 passed · flaky` is the thing a single run could never say, and the
 * reason sampling exists: before this, a test that passes three times in five
 * printed whichever of "passed" and "failed" the Owner happened to press.
 */
function BatchVerdict({ batch }: { batch: AgentTestBatch }) {
    if (batch.running > 0) {
        return (
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: ATLAS_PALETTE.slate60 }}>
                {batch.n_runs > 1 ? `running ${batch.n_runs - batch.running}/${batch.n_runs}…` : 'running…'}
            </Typography>
        );
    }
    const judged = batch.n_runs - batch.errored;
    // Nothing ran at all — a broken environment, not a failing agent.
    if (judged === 0) {
        return (
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: ATLAS_PALETTE.amber }}>
                could not run
            </Typography>
        );
    }
    const colour = batch.flaky
        ? ATLAS_PALETTE.amber
        : batch.passed === judged
          ? ATLAS_PALETTE.greenDark
          : ATLAS_PALETTE.red;
    return (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: colour }}>
                {judged > 1 ? `${batch.passed}/${judged} passed` : batch.passed === 1 ? 'passed' : 'failed'}
            </Typography>
            {batch.flaky && (
                <Tooltip title="It passed sometimes. A verdict from one run would have been a coin flip.">
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: ATLAS_PALETTE.amber }}>
                        · flaky
                    </Typography>
                </Tooltip>
            )}
            {batch.errored > 0 && (
                <Tooltip title="Dispatches that never started — a broken environment, not a wrong answer. They are left out of the score.">
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.amber }}>
                        · {batch.errored} could not run
                    </Typography>
                </Tooltip>
            )}
        </Box>
    );
}

/** One segment per sample, in the order they were taken. */
function SampleStrip({ batch }: { batch: AgentTestBatch }) {
    if (batch.n_runs < 2) return null;
    return (
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }} aria-label={`${batch.n_runs} samples`}>
            {batch.runs.map((r) => (
                <Tooltip key={r.id} title={`Sample ${r.sample_index + 1}: ${VERDICT[r.verdict].label}`}>
                    <Box
                        sx={{
                            height: 6,
                            flex: 1,
                            maxWidth: 48,
                            borderRadius: '3px',
                            background: VERDICT[r.verdict].color,
                            opacity: r.verdict === 'running' ? 0.35 : 1,
                        }}
                    />
                </Tooltip>
            ))}
        </Box>
    );
}

function BatchBlock({ batch }: { batch: AgentTestBatch }) {
    return (
        <Box sx={{ py: 1.25, borderTop: `1px solid ${ATLAS_PALETTE.slate12}` }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <BatchVerdict batch={batch} />
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {relativeTime(batch.created_at)}
                </Typography>
                {batch.cost_usd > 0 && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {formatCostUsd(batch.cost_usd)}
                    </Typography>
                )}
                {batch.duration_s_p50 != null && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {batch.duration_s_p50}s median
                    </Typography>
                )}
                {batch.label && (
                    <Typography
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            background: ATLAS_PALETTE.slate06,
                            borderRadius: '4px',
                            px: 0.75,
                        }}
                    >
                        {batch.label}
                    </Typography>
                )}
            </Box>
            <SampleStrip batch={batch} />
            {/* WHICH expectation was unstable, not merely that something was.
                "3 of 5 runs" is the part a single verdict cannot express. */}
            {batch.failure_histogram.map((f) => (
                <Typography key={f.failure} sx={{ fontSize: 12, color: ATLAS_PALETTE.red, pl: 0.5, mt: 0.5 }}>
                    • {batch.n_runs > 1 ? `${f.count} of ${batch.n_runs} runs: ` : ''}
                    {f.failure}
                </Typography>
            ))}
        </Box>
    );
}

function TestCard({ test, agentId }: { test: AgentTest; agentId: string }) {
    const [open, setOpen] = useState(false);
    const [samples, setSamples] = useState(1);
    // Always fetched, not only while expanded: the headline verdict is the
    // point of the row, and a batch still running has to keep polling.
    const { data: batches } = useAgentTestBatches(test.id);
    const runTest = useRunAgentTest();
    const removeTest = useDeleteAgentTest(agentId);
    const { data: estimate } = useAgentCostEstimate(agentId, samples);
    const toast = useToast();

    const last = batches?.[0];
    return (
        <Box sx={{ border: `1px solid ${ATLAS_PALETTE.slate12}`, borderRadius: 1, p: 2, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{test.name}</Typography>
                {last && <BatchVerdict batch={last} />}
                <Button size="small" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Hide' : 'History'}
                </Button>
                <TextField
                    select
                    size="small"
                    value={samples}
                    onChange={(e) => setSamples(Number(e.target.value))}
                    label="Runs"
                    sx={{ width: 96 }}
                    slotProps={{ htmlInput: { 'aria-label': `Samples for ${test.name}` } }}
                >
                    {SAMPLE_CHOICES.map((n) => (
                        <MenuItem key={n} value={n}>
                            {n === 1 ? '1' : `${n}×`}
                        </MenuItem>
                    ))}
                </TextField>
                <Button
                    size="small"
                    variant="contained"
                    disabled={runTest.isPending}
                    onClick={() => {
                        setOpen(true);
                        runTest.mutate(
                            { testId: test.id, n_runs: samples },
                            {
                                onSuccess: () =>
                                    toast.show({
                                        message: samples > 1 ? `${samples} runs started` : 'Test started',
                                    }),
                                onError: (e) => toast.show({ message: (e as Error).message }),
                            },
                        );
                    }}
                >
                    {/* The TOTAL, not the per-run figure: `5×` silently costing
                        five times over is exactly the surprise ADR 0023 says
                        stops people running tests at all. */}
                    {runTest.isPending
                        ? 'Starting…'
                        : estimate?.estimated_total_usd != null
                          ? `Run · ~${formatCostUsd(estimate.estimated_total_usd)}`
                          : 'Run'}
                </Button>
                <Button
                    size="small"
                    color="error"
                    onClick={() => removeTest.mutate(test.id)}
                    aria-label={`Delete ${test.name}`}
                >
                    Delete
                </Button>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                {test.item_template.issue_type === 'sub_task' ? 'Sub-task' : 'Task'}: {test.item_template.title}
                {test.expectations.outcome_kind ? ` · expects ${test.expectations.outcome_kind}` : ''}
            </Typography>
            {/* The strip under the headline, so a flaky result is visible
                without opening the history. */}
            {last && !open && <SampleStrip batch={last} />}
            <Collapse in={open}>
                <Box sx={{ mt: 1 }}>
                    {!batches ? (
                        <CircularProgress size={16} />
                    ) : batches.length === 0 ? (
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            Never run.
                        </Typography>
                    ) : (
                        batches.map((b) => <BatchBlock key={b.batch_id} batch={b} />)
                    )}
                </Box>
            </Collapse>
        </Box>
    );
}

export function TestsTabContent({ agent }: { agent: IAgent }) {
    const { data: tests, isLoading } = useAgentTests(agent.id);
    const { data: projects } = useProjects();
    const createTest = useCreateAgentTest(agent.id);
    const toast = useToast();

    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const [projectId, setProjectId] = useState('');
    const [repoId, setRepoId] = useState('');
    const [issueType, setIssueType] = useState<'task' | 'sub_task'>('task');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [outcome, setOutcome] = useState<string>('');
    const { data: repos } = useProjectRepos(projectId);

    function submit() {
        createTest.mutate(
            {
                project_id: projectId,
                repo_id: repoId || null,
                name: name.trim(),
                item_template: { issue_type: issueType, title: title.trim(), description },
                ...(outcome ? { expectations: { outcome_kind: outcome as 'done' } } : {}),
            },
            {
                onSuccess: () => {
                    toast.show({ message: 'Test created' });
                    setAdding(false);
                    setName('');
                    setTitle('');
                    setDescription('');
                    setRepoId('');
                },
                onError: (e) => toast.show({ message: (e as Error).message }),
            },
        );
    }

    // A repo is required whenever the project has more than one: `resolveRepoIds`
    // refuses to guess, and the failure otherwise lands at dispatch rather than
    // at the form.
    const needsRepo = (repos ?? []).length > 1;
    const canSubmit = Boolean(name.trim() && title.trim() && projectId && (!needsRepo || repoId));

    return (
        <Box sx={{ px: { xs: 3, md: 4 }, py: 3 }}>
            {/* `alignItems: flex-start` and a real gap: the description is two
                lines, so centring the button against it looks misaligned, and
                without the gap the text runs flush into the button. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 2 }}>
                <Box sx={{ flex: 1, maxWidth: 680 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Tests</Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                        Give this agent a realistic item to act on and say what should happen. Unlike a Test
                        Run, a test is saved, judged and kept — so you can tell whether the agent still works
                        after you change its prompt.
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    sx={{ flexShrink: 0 }}
                    onClick={() => setAdding((v) => !v)}
                >
                    {adding ? 'Cancel' : 'New test'}
                </Button>
            </Box>

            <Collapse in={adding}>
                <Box
                    sx={{
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: 1,
                        p: 2,
                        mb: 2,
                        display: 'grid',
                        gap: 1.5,
                    }}
                >
                    <TextField
                        size="small"
                        label="Test name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <TextField
                        size="small"
                        select
                        label="Project"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        helperText="The throwaway item is created here, and its repos are what the agent works in."
                    >
                        {(projects ?? []).map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    {/* ADR 0018: every Task names at least one repo, and the
                        project has more than one, so there is nothing sensible
                        to pick by default. Without this the run fails with
                        "A Task needs at least one repo" at dispatch time. */}
                    <TextField
                        size="small"
                        select
                        label="Repo"
                        value={repoId}
                        onChange={(e) => setRepoId(e.target.value)}
                        disabled={!projectId}
                        helperText={
                            repos && repos.length > 1
                                ? 'The repo the agent works in. Required when the project has more than one.'
                                : 'The repo the agent works in.'
                        }
                    >
                        {(repos ?? []).map((r) => (
                            <MenuItem key={r.id} value={r.id}>
                                {r.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        size="small"
                        select
                        label="Item kind"
                        value={issueType}
                        onChange={(e) => setIssueType(e.target.value as 'task')}
                        helperText="Most agents refuse the wrong kind — PO Writer only scopes Tasks, Coder only builds sub-tasks."
                    >
                        <MenuItem value="task">Task</MenuItem>
                        <MenuItem value="sub_task">Sub-task</MenuItem>
                    </TextField>
                    <TextField
                        size="small"
                        label="Item title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                    <TextField
                        size="small"
                        multiline
                        minRows={3}
                        label="Item description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <TextField
                        size="small"
                        select
                        label="Expected outcome"
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        helperText="An agent that asks rather than guessing has succeeded — expect asked_question when that is the right answer."
                    >
                        {OUTCOMES.map((o) => (
                            <MenuItem key={o.value} value={o.value}>
                                {o.label}
                            </MenuItem>
                        ))}
                    </TextField>
                    <Box>
                        <Button variant="contained" disabled={!canSubmit || createTest.isPending} onClick={submit}>
                            {createTest.isPending ? 'Creating…' : 'Create test'}
                        </Button>
                    </Box>
                </Box>
            </Collapse>

            {isLoading ? (
                <CircularProgress size={20} />
            ) : (tests ?? []).length === 0 ? (
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    No tests yet. Without one there is no way to tell whether this agent works, or whether it
                    still works after its prompt changes.
                </Typography>
            ) : (
                (tests ?? []).map((t) => <TestCard key={t.id} test={t} agentId={agent.id} />)
            )}
        </Box>
    );
}
