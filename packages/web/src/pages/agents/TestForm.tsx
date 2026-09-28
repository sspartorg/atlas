import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';

import { useCreateAgentTest, useUpdateAgentTest } from '../../hooks/useAgentTests.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import type { AgentTest, StarterTest } from '../../api/types.js';
import { InfoPanel } from '../../components/InfoPanel.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { applyChecks, checksFrom, EMPTY_CHECKS, type ChecksForm } from './testChecks.js';

// The create / edit / adopt form for one agent test.
//
// Its own component with its own state: while it lived in the tab, every
// keystroke re-rendered every test row on the page.

const OUTCOMES = [
    { value: '', label: 'Any outcome' },
    { value: 'done', label: 'done — finished the work' },
    { value: 'rejected', label: 'rejected — sent the work back' },
    // First-class, not a fallback: an agent that asks rather than inventing a
    // feature from an unanswerable Task has SUCCEEDED.
    { value: 'asked_question', label: 'asked_question — asked instead of guessing' },
] as const;

/** The empty project choice: the Tests sandbox the API creates on first use. */
export const SANDBOX_LABEL = 'Tests sandbox (default)';

export type TestFormSource = { kind: 'new' } | { kind: 'edit'; test: AgentTest } | { kind: 'adopt'; starter: StarterTest };

function Section({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Box sx={{ display: 'grid', gap: 2, pt: 2.5, borderTop: `1px solid ${ATLAS_PALETTE.slate06}` }}>
            <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate60, lineHeight: 1.4 }}>
                {label}
            </Typography>
            {children}
        </Box>
    );
}

/** Two short fields side by side on a wide column, stacked on a phone. */
function Pair({ children }: { children: ReactNode }) {
    return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>{children}</Box>;
}

export function TestForm({
    agentId,
    source,
    projects,
    onDone,
}: {
    agentId: string;
    source: TestFormSource;
    projects: Array<{ id: string; name: string }>;
    onDone: () => void;
}) {
    const editing = source.kind === 'edit' ? source.test : null;
    const adopted = source.kind === 'adopt' ? source.starter : null;
    const prefill = editing ?? adopted;

    const [name, setName] = useState(prefill?.name ?? '');
    const [projectId, setProjectId] = useState(editing?.project_id ?? '');
    const [repoId, setRepoId] = useState(editing?.repo_id ?? '');
    const [issueType, setIssueType] = useState<'task' | 'sub_task'>(prefill?.item_template.issue_type ?? 'task');
    const [title, setTitle] = useState(prefill?.item_template.title ?? '');
    const [description, setDescription] = useState(prefill?.item_template.description ?? '');
    const [outcome, setOutcome] = useState<string>(prefill?.expectations.outcome_kind ?? '');
    const [checks, setChecks] = useState<ChecksForm>(prefill ? checksFrom(prefill.expectations) : EMPTY_CHECKS);
    const setCheck = <K extends keyof ChecksForm>(key: K, value: ChecksForm[K]) =>
        setChecks((c) => ({ ...c, [key]: value }));

    const { data: repos } = useProjectRepos(projectId);
    const createTest = useCreateAgentTest(agentId);
    const updateTest = useUpdateAgentTest(agentId);
    const toast = useToast();

    // A repo is required whenever the project has more than one: `resolveRepoIds`
    // refuses to guess, and the failure otherwise lands at dispatch rather than
    // at the form.
    const needsRepo = (repos ?? []).length > 1;
    const canSubmit = Boolean(name.trim() && title.trim() && (!needsRepo || repoId));
    const pending = createTest.isPending || updateTest.isPending;

    function submit() {
        const done = (message: string) => ({
            onSuccess: () => {
                toast.show({ message });
                onDone();
            },
            onError: (e: unknown) => toast.show({ message: (e as Error).message }),
        });
        if (editing) {
            // Merge, never replace: the form shows only part of what a test can
            // assert, and a save must not silently drop a tools_forbidden or a
            // cost ceiling it never displayed. "Any outcome" clears the outcome.
            const { outcome_kind: _cleared, ...kept } = editing.expectations;
            updateTest.mutate(
                {
                    testId: editing.id,
                    body: {
                        name: name.trim(),
                        project_id: projectId || null,
                        repo_id: repoId || null,
                        item_template: { ...editing.item_template, issue_type: issueType, title: title.trim(), description },
                        expectations: applyChecks(
                            { ...kept, ...(outcome ? { outcome_kind: outcome as 'done' } : {}) },
                            checks,
                        ),
                    },
                },
                done('Test saved'),
            );
            return;
        }
        createTest.mutate(
            {
                project_id: projectId || null,
                repo_id: repoId || null,
                name: name.trim(),
                item_template: { issue_type: issueType, title: title.trim(), description },
                // Everything the shipped test asserted, not just the outcome the
                // form can show: a tools_forbidden or a cost ceiling silently
                // dropped on adoption would make the copy weaker than the original.
                expectations: applyChecks(
                    { ...(adopted?.expectations ?? {}), ...(outcome ? { outcome_kind: outcome as 'done' } : {}) },
                    checks,
                ),
            },
            done('Test created'),
        );
    }

    return (
        <InfoPanel label={editing ? 'Edit test' : adopted ? 'Add a shipped test' : 'New test'}>
            <Box sx={{ display: 'grid', gap: 2.5 }}>
                <TextField size="small" label="Test name" value={name} onChange={(e) => setName(e.target.value)} />

                <Section label="What it acts on">
                    <Pair>
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
                    </Pair>
                    <TextField size="small" label="Item title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <TextField
                        size="small"
                        multiline
                        minRows={3}
                        label="Item description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </Section>

                <Section label="Where it runs">
                    <Pair>
                        <TextField
                            size="small"
                            select
                            label="Project"
                            value={projectId}
                            onChange={(e) => {
                                setProjectId(e.target.value);
                                setRepoId('');
                            }}
                            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                            helperText="Where the test's Task is created. The sandbox keeps test runs out of your real projects."
                        >
                            <MenuItem value="">{SANDBOX_LABEL}</MenuItem>
                            {projects.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name}
                                </MenuItem>
                            ))}
                        </TextField>
                        {/* ADR 0018: every Task names at least one repo. Without
                            this a multi-repo project fails the run at dispatch
                            with "A Task needs at least one repo". */}
                        <TextField
                            size="small"
                            select
                            label="Repo"
                            value={repoId}
                            onChange={(e) => setRepoId(e.target.value)}
                            disabled={!projectId}
                            helperText={
                                needsRepo ? 'Required when the project has more than one repo.' : 'The repo the agent works in.'
                            }
                        >
                            {(repos ?? []).map((r) => (
                                <MenuItem key={r.id} value={r.id}>
                                    {r.name}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Pair>
                </Section>

                {/* Scope checks (ADR 0023 amendment): judged on what the agent
                    actually said, ran and changed — not on its own summary. */}
                <Section label="Checks">
                    <FormControlLabel
                        control={
                            <Switch
                                size="small"
                                checked={checks.readOnly}
                                onChange={(e) => setCheck('readOnly', e.target.checked)}
                            />
                        }
                        label="Read-only agent — must not edit any file"
                        slotProps={{ typography: { variant: 'body1' } }}
                    />
                    <Pair>
                        <TextField
                            size="small"
                            multiline
                            minRows={2}
                            label="Reply must match"
                            value={checks.replyMustMatch}
                            onChange={(e) => setCheck('replyMustMatch', e.target.value)}
                            helperText="One pattern per line, case-insensitive. Every line must match the agent's final reply, e.g. menu|order"
                        />
                        <TextField
                            size="small"
                            multiline
                            minRows={2}
                            label="Reply must not match"
                            value={checks.replyMustNotMatch}
                            onChange={(e) => setCheck('replyMustNotMatch', e.target.value)}
                            helperText="Off-topic answers to catch, e.g. president|election"
                        />
                        <TextField
                            size="small"
                            multiline
                            minRows={2}
                            label="Forbidden shell commands"
                            value={checks.commandsForbidden}
                            onChange={(e) => setCheck('commandsForbidden', e.target.value)}
                            helperText="One pattern per line; no command it runs may match, e.g. ^git push"
                        />
                        <TextField
                            size="small"
                            multiline
                            minRows={2}
                            label="Judge questions"
                            value={checks.judgeCriteria}
                            onChange={(e) => setCheck('judgeCriteria', e.target.value)}
                            helperText="One yes/no question per line, graded by a small model on the agent's reply and what it ran."
                        />
                    </Pair>
                    <TextField
                        size="small"
                        multiline
                        minRows={3}
                        label="Check script (bash)"
                        value={checks.script}
                        onChange={(e) => setCheck('script', e.target.value)}
                        slotProps={{ htmlInput: { sx: { fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12 } } }}
                        helperText="Runs in a folder with reply.txt, commands.txt, tool_calls.json, files_changed.txt, diff.patch and outcome.json. Exit 0 passes; what it prints on failure is the reason."
                    />
                </Section>

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.5 }}>
                    <Button variant="contained" disabled={!canSubmit || pending} onClick={submit}>
                        {editing
                            ? updateTest.isPending
                                ? 'Saving…'
                                : 'Save changes'
                            : createTest.isPending
                              ? 'Creating…'
                              : 'Create test'}
                    </Button>
                </Box>
            </Box>
        </InfoPanel>
    );
}
