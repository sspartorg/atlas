import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent } from '@atlas/shared';

import {
    useAgentCostEstimate,
    useAgentTestBatches,
    useAgentTests,
    useStarterTests,
    useCreateAgentTest,
    useDeleteAgentTest,
    useRunAgentTest,
} from '../../hooks/useAgentTests.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import type { AgentTest, AgentTestBatch, AgentTestRun, StarterTest } from '../../api/types.js';
import { EmptyState } from '../../components/EmptyState.js';
import { InfoPanel } from '../../components/InfoPanel.js';
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
                <Tooltip title="Passed in some samples, failed in others.">
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: ATLAS_PALETTE.amber }}>
                        · flaky
                    </Typography>
                </Tooltip>
            )}
            {batch.errored > 0 && (
                <Tooltip title="Dispatches that never started. Not counted in the score.">
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

/**
 * Everything this test asserts, in words.
 *
 * Expectations can be set from the API, from MCP, or arrive with a starter
 * test — so the card has to say what a test checks rather than showing only
 * the one field the create form happens to offer.
 */
function expectationSummary(e: AgentTest['expectations']): string[] {
    const out: string[] = [];
    if (e.outcome_kind) out.push(`ends \`${e.outcome_kind}\``);
    if (e.required_checklist_all_passed) out.push('every required checklist row passed');
    for (const t of e.summary_contains ?? []) out.push(`says "${t}"`);
    for (const t of e.summary_omits ?? []) out.push(`does not say "${t}"`);
    for (const t of e.tools_required ?? []) out.push(`uses \`${t}\``);
    for (const t of e.tools_forbidden ?? []) out.push(`never uses \`${t}\``);
    if (e.max_turns != null) out.push(`≤ ${e.max_turns} turns`);
    if (e.max_tool_calls != null) out.push(`≤ ${e.max_tool_calls} tool calls`);
    for (const f of e.files_touched ?? []) out.push(`touches ${f}`);
    for (const f of e.files_untouched ?? []) out.push(`leaves ${f} alone`);
    for (const c of e.judge_criteria ?? []) out.push(`judged: ${c}`);
    if (e.max_cost_usd != null) out.push(`under $${e.max_cost_usd}`);
    if (e.max_duration_s != null) out.push(`under ${e.max_duration_s}s`);
    return out;
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
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 2.5,
                mb: 1.5,
            }}
        >
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
            {/* A test whose assertions you cannot see is half a test — and
                expectations arrive from the API and from starter tests, not
                only from the one field the create form offers. */}
            {expectationSummary(test.expectations).length > 0 && (
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.25 }}>
                    Checks: {expectationSummary(test.expectations).join(' · ')}
                </Typography>
            )}
            {/* The strip under the headline, so a flaky result is visible
                without opening the history. */}
            {last && !open && <SampleStrip batch={last} />}
            <Collapse in={open}>
                <Box sx={{ mt: 1 }}>
                    {!batches ? (
                        <Skeleton variant="rounded" height={56} />
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

/**
 * The tests this agent shipped with (ADR 0023 phase 4).
 *
 * Templates rather than rows: `agent_tests` needs a project and a repo, and a
 * catalog bundle has neither. Adopting one writes an ordinary test that is
 * then the Owner's, which is also why a bundle upgrade can never clobber it.
 *
 * Hidden once every one of them has been adopted — a permanent strip of
 * things you have already done is noise.
 */
function StarterTests({
    starters,
    existing,
    onAdopt,
}: {
    starters: StarterTest[];
    existing: AgentTest[];
    onAdopt: (t: StarterTest) => void;
}) {
    const taken = new Set(existing.map((t) => t.name));
    const available = starters.filter((t) => !taken.has(t.name));
    if (available.length === 0) return null;

    return (
        <InfoPanel label="Ships with this agent" mb={2.5}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 1.5 }}>
                Add makes your own copy. Upgrades never change it.
            </Typography>
            <Box sx={{ display: 'grid', gap: 1.25 }}>
                {available.map((t) => (
                    <Box key={t.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t.name}</Typography>
                            {/* What it asserts, not why it exists. The rationale
                                is a hover: it is a caption, and an essay here is
                                a layout bug. */}
                            <Typography
                                title={t.notes}
                                sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}
                            >
                                {expectationSummary(t.expectations).join(' · ')}
                            </Typography>
                        </Box>
                        <Button size="small" variant="outlined" onClick={() => onAdopt(t)} sx={{ flexShrink: 0 }}>
                            Add
                        </Button>
                    </Box>
                ))}
            </Box>
        </InfoPanel>
    );
}

export function TestsTabContent({ agent }: { agent: IAgent }) {
    const { data: tests, isLoading } = useAgentTests(agent.id);
    const { data: starters = [] } = useStarterTests(agent.id);
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
    /** Set when the form was opened by adopting a starter test. */
    const [adopted, setAdopted] = useState<StarterTest | null>(null);
    const { data: repos } = useProjectRepos(projectId);

    /**
     * Prefill the form from a shipped test.
     *
     * Through the same form rather than a one-click create, because a test
     * needs a project to make its throwaway item in and a repo for the agent
     * to work in — neither of which a catalog bundle can know.
     */
    function adopt(t: StarterTest) {
        setAdopted(t);
        setName(t.name);
        setIssueType(t.item_template.issue_type);
        setTitle(t.item_template.title);
        setDescription(t.item_template.description ?? '');
        setOutcome(t.expectations.outcome_kind ?? '');
        setAdding(true);
    }

    function submit() {
        createTest.mutate(
            {
                project_id: projectId,
                repo_id: repoId || null,
                name: name.trim(),
                item_template: { issue_type: issueType, title: title.trim(), description },
                // Everything the shipped test asserted, not just the
                // outcome the form can show: a tools_forbidden or a cost
                // ceiling silently dropped on adoption would make the adopted
                // copy weaker than the one it came from.
                expectations: {
                    ...(adopted?.expectations ?? {}),
                    ...(outcome ? { outcome_kind: outcome as 'done' } : {}),
                },
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
        // No padding of its own: `AgentDetail` already pads the tab column, and
        // a second layer indents this panel past every sibling tab.
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate60,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                    }}
                >
                    Tests
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>
                    · {(tests ?? []).length}
                </Typography>
                <Box sx={{ ml: 'auto' }}>
                    <Button
                        variant="contained"
                        onClick={() => {
                            setAdopted(null);
                            setAdding((v) => !v);
                        }}
                    >
                        {adding ? 'Cancel' : 'New test'}
                    </Button>
                </Box>
            </Box>

            <Collapse in={adding}>
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        p: 2.5,
                        mb: 2.5,
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
                        helperText="The throwaway item is created in this project."
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
                                ? 'Required when the project has more than one repo.'
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
                        helperText="Most agents accept one kind. PO Writer takes Tasks, Coder takes sub-tasks."
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
                        helperText="asked_question is a pass. Pick it when asking is the right answer."
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
                <>
                    <Skeleton variant="rounded" height={88} sx={{ mb: 1.5 }} />
                    <Skeleton variant="rounded" height={88} />
                </>
            ) : (tests ?? []).length === 0 ? (
                // No action button: "New test" is already in the header row
                // above, and a second control with the same accessible name
                // makes `getByRole('button', { name: 'New test' })' ambiguous.
                <Box sx={{ mb: 2.5 }}>
                    <EmptyState
                        variant="dashed"
                        icon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 32 }}
                            >
                                science
                            </Box>
                        }
                        title="No tests yet"
                        description="A test runs this agent on a throwaway item and checks the outcome. Run it again after a prompt change to see what broke."
                    />
                </Box>
            ) : (
                (tests ?? []).map((t) => <TestCard key={t.id} test={t} agentId={agent.id} />)
            )}

            {/* Below the list: once every shipped test is adopted this strip
                disappears, and an empty tab should lead with its own empty
                state rather than two stacked boxes. */}
            <StarterTests starters={starters} existing={tests ?? []} onAdopt={adopt} />
        </Box>
    );
}
