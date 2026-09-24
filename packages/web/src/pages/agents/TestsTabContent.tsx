import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import type { IAgent } from '@atlas/shared';

import {
    useAgentCostEstimate,
    useAgentTestRuns,
    useAgentTests,
    useCreateAgentTest,
    useDeleteAgentTest,
    useRunAgentTest,
} from '../../hooks/useAgentTests.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import type { AgentTest, AgentTestRun } from '../../api/types.js';
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

function RunRow({ run }: { run: AgentTestRun }) {
    const v = VERDICT[run.verdict];
    return (
        <Box sx={{ py: 1, borderTop: `1px solid ${ATLAS_PALETTE.slate12}` }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: v.color, minWidth: 90 }}>
                    {v.label}
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                    {relativeTime(run.created_at)}
                </Typography>
                {run.cost_usd != null && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {formatCostUsd(run.cost_usd)}
                    </Typography>
                )}
                {run.duration_s != null && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{run.duration_s}s</Typography>
                )}
                {run.item_id && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{run.item_id}</Typography>
                )}
            </Box>
            {/* Every expectation that did not hold. A verdict you cannot act on
                is barely better than no verdict. */}
            {run.failures.map((f, i) => (
                <Typography key={i} sx={{ fontSize: 12, color: ATLAS_PALETTE.red, pl: 0.5 }}>
                    • {f}
                </Typography>
            ))}
        </Box>
    );
}

function TestCard({ test, agentId }: { test: AgentTest; agentId: string }) {
    const [open, setOpen] = useState(false);
    const { data: runs } = useAgentTestRuns(test.id, open);
    const runTest = useRunAgentTest();
    const removeTest = useDeleteAgentTest(agentId);
    const { data: estimate } = useAgentCostEstimate(agentId);
    const toast = useToast();

    const last = runs?.[0];
    return (
        <Box sx={{ border: `1px solid ${ATLAS_PALETTE.slate12}`, borderRadius: 1, p: 2, mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{test.name}</Typography>
                {last && (
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: VERDICT[last.verdict].color }}>
                        {VERDICT[last.verdict].label}
                    </Typography>
                )}
                <Button size="small" onClick={() => setOpen((v) => !v)}>
                    {open ? 'Hide' : 'History'}
                </Button>
                <Button
                    size="small"
                    variant="contained"
                    disabled={runTest.isPending}
                    onClick={() => {
                        setOpen(true);
                        runTest.mutate(test.id, {
                            onSuccess: () => toast.show({ message: 'Test started' }),
                            onError: (e) => toast.show({ message: (e as Error).message }),
                        });
                    }}
                >
                    {/* The estimate is shown on the button itself. Spend that
                        surprises you afterwards is what stops people running
                        tests at all. */}
                    {runTest.isPending
                        ? 'Starting…'
                        : estimate?.estimated_cost_usd != null
                          ? `Run · ~${formatCostUsd(estimate.estimated_cost_usd)}`
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
            <Collapse in={open}>
                <Box sx={{ mt: 1 }}>
                    {!runs ? (
                        <CircularProgress size={16} />
                    ) : runs.length === 0 ? (
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            Never run.
                        </Typography>
                    ) : (
                        runs.map((r) => <RunRow key={r.id} run={r} />)
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
