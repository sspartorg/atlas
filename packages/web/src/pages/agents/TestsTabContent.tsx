import { memo, useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent } from '@atlas/shared';

import {
    HISTORY_BATCHES,
    useAgentCostEstimate,
    useAgentQualification,
    useAgentTestBatches,
    useAgentTests,
    useStarterTests,
    useDeleteAgentTest,
    useRunAgentSuite,
    useRunAgentTest,
} from '../../hooks/useAgentTests.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import type {
    AgentQualification,
    AgentTest,
    AgentTestBatch,
    AgentTestRun,
    QualificationVerdict,
    StarterTest,
} from '../../api/types.js';
import { EmptyState } from '../../components/EmptyState.js';
import { InfoPanel } from '../../components/InfoPanel.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { runStatusPaletteEntry } from '../../theme/runStatusPalette.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { relativeTime } from '../../utils/time.js';
import { SANDBOX_LABEL, TestForm, type TestFormSource } from './TestForm.js';

// Agent tests (ADR 0023).
//
// A customer installing an agent from the marketplace does it on trust, and an
// agent they wrote themselves cannot be qualified at all. This is where that
// stops being true.
//
// A test carries the ITEM the agent should act on rather than a prompt, because
// a prompt cannot exercise the agents Atlas ships — PO Writer refuses anything
// that is not a Task, Coder needs a sub-task with a repo.
//
// Layout follows the Runs tab: one card, one grid row per test. Each row's
// headline batch arrives with the list (one request for the tab); a row's
// history is fetched only when it is opened.

/** A sample's verdict, in the run-status colours the Runs tab already uses. */
const VERDICT: Record<AgentTestRun['verdict'], { label: string; dot: string }> = {
    passed: { label: 'passed', dot: runStatusPaletteEntry('completed').dot },
    failed: { label: 'failed', dot: runStatusPaletteEntry('failed').dot },
    // Not `failed`: the dispatch never ran, which is a broken environment
    // rather than a failing agent (the ADR 0020 distinction).
    errored: { label: 'could not run', dot: runStatusPaletteEntry('cancelled').dot },
    running: { label: 'running…', dot: runStatusPaletteEntry('running').dot },
};

/** Runs per press. An agent is stochastic; one sample is a coin flip. */
const SAMPLE_CHOICES = [3, 5, 10] as const;

// A fixed actions column, so the header row (which has no buttons) lines up
// with the rows (which do).
const COLUMNS = { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) 150px 72px 84px 64px 168px' } as const;
// One element per cell at every width: on a phone the verdict and the actions
// share the second line, so the name keeps the full width.
const AREAS = { xs: '"name name" "verdict actions"', md: '"name verdict samples last cost actions"' } as const;

function Dot({ color, faint = false }: { color: string; faint?: boolean }) {
    return (
        <Box
            component="span"
            sx={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: faint ? 0.4 : 1, flexShrink: 0 }}
        />
    );
}

/**
 * The verdict, as a sentence rather than a chip.
 *
 * `3/5 passed · flaky` is the thing a single run could never say, and the
 * reason sampling exists.
 */
function batchVerdict(batch: AgentTestBatch): { text: string; dot: string; note?: string } {
    if (batch.running > 0) {
        return {
            text: batch.n_runs > 1 ? `running ${batch.n_runs - batch.running}/${batch.n_runs}…` : 'running…',
            dot: VERDICT.running.dot,
        };
    }
    const judged = batch.n_runs - batch.errored;
    // Nothing ran at all — a broken environment, not a failing agent.
    if (judged === 0) return { text: 'could not run', dot: VERDICT.errored.dot };
    const text = judged > 1 ? `${batch.passed}/${judged} passed` : batch.passed === 1 ? 'passed' : 'failed';
    const dot = batch.flaky ? VERDICT.errored.dot : batch.passed === judged ? VERDICT.passed.dot : VERDICT.failed.dot;
    const notes = [
        batch.flaky ? 'flaky' : '',
        batch.errored > 0 ? `${batch.errored} could not run` : '',
    ].filter(Boolean);
    return notes.length ? { text, dot, note: notes.join(' · ') } : { text, dot };
}

function BatchVerdict({ batch }: { batch: AgentTestBatch }) {
    const v = batchVerdict(batch);
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Dot color={v.dot} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: ATLAS_PALETTE.slate, whiteSpace: 'nowrap' }}>
                {v.text}
            </Typography>
            {v.note && (
                <Typography
                    title={
                        batch.flaky
                            ? 'Passed in some samples, failed in others.'
                            : 'Dispatches that never started. Not counted in the score.'
                    }
                    sx={{ fontSize: 12, color: ATLAS_PALETTE.warnFg, whiteSpace: 'nowrap' }}
                >
                    · {v.note}
                </Typography>
            )}
        </Box>
    );
}

/** One dot per sample, in the order they were taken. Native titles: a Tooltip per dot was the heaviest thing on the page. */
function SampleDots({ batch }: { batch: AgentTestBatch }) {
    return (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }} aria-label={`${batch.n_runs} samples`}>
            {batch.runs.map((r) => (
                <Box
                    key={r.id}
                    component="span"
                    title={`Sample ${r.sample_index + 1}: ${VERDICT[r.verdict].label}`}
                    sx={{ display: 'inline-flex' }}
                >
                    <Dot color={VERDICT[r.verdict].dot} faint={r.verdict === 'running'} />
                </Box>
            ))}
        </Box>
    );
}

const META = { fontSize: 12, color: ATLAS_PALETTE.slate60 } as const;
const MONO = { fontSize: 12, fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate70 } as const;

function BatchRow({ batch }: { batch: AgentTestBatch }) {
    return (
        <Box sx={{ py: 1.25, borderTop: `1px solid ${ATLAS_PALETTE.slate06}`, '&:first-of-type': { borderTop: 0 } }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <BatchVerdict batch={batch} />
                {batch.n_runs > 1 && <SampleDots batch={batch} />}
                <Typography sx={META}>{relativeTime(batch.created_at)}</Typography>
                {batch.cost_usd > 0 && <Typography sx={MONO}>{formatCostUsd(batch.cost_usd)}</Typography>}
                {batch.duration_s_p50 != null && <Typography sx={META}>{batch.duration_s_p50}s median</Typography>}
                {batch.label && (
                    <Typography
                        sx={{ ...MONO, fontSize: 11, background: ATLAS_PALETTE.slate06, borderRadius: '4px', px: 1 }}
                    >
                        {batch.label}
                    </Typography>
                )}
            </Box>
            {/* WHICH expectation was unstable, not merely that something was.
                "3 of 5 runs" is the part a single verdict cannot express. */}
            {batch.failure_histogram.map((f) => (
                <Typography key={f.failure} sx={{ fontSize: 12, color: ATLAS_PALETTE.dangerFg, mt: 0.5 }}>
                    • {batch.n_runs > 1 ? `${f.count} of ${batch.n_runs} runs: ` : ''}
                    {f.failure}
                </Typography>
            ))}
        </Box>
    );
}

/** Mounted only while a row is open, so a closed row costs no request. */
function TestHistory({ testId }: { testId: string }) {
    const { data: batches } = useAgentTestBatches(testId);
    if (!batches) return <Skeleton variant="rounded" height={48} />;
    if (batches.length === 0) return <Typography sx={META}>Never run.</Typography>;
    return (
        <>
            {batches.map((b) => (
                <BatchRow key={b.batch_id} batch={b} />
            ))}
            {batches.length >= HISTORY_BATCHES && (
                <Typography sx={{ ...META, pt: 1 }}>Showing the newest {HISTORY_BATCHES} runs.</Typography>
            )}
        </>
    );
}

/**
 * Everything this test asserts, in words.
 *
 * Expectations arrive from the API, from MCP and with starter tests — so the
 * row says what a test checks rather than only the field the form offers.
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
    for (const p of e.reply_must_match ?? []) out.push(`reply matches /${p}/`);
    for (const p of e.reply_must_not_match ?? []) out.push(`reply avoids /${p}/`);
    for (const p of e.commands_forbidden ?? []) out.push(`never runs /${p}/`);
    if (e.no_code_changes) out.push('changes no code');
    for (const f of e.files_changed_only ?? []) out.push(`changes only ${f}`);
    if (e.script) out.push('passes your script');
    for (const c of e.judge_criteria ?? []) out.push(`judged: ${c}`);
    if (e.max_cost_usd != null) out.push(`under $${e.max_cost_usd}`);
    if (e.max_duration_s != null) out.push(`under ${e.max_duration_s}s`);
    return out;
}

/**
 * The suite verdict, in the Owner's words.
 *
 * Seven states rather than a percentage: "never run" is not a low score, and
 * "passing, on a model you have since changed" is not a pass. Deliberately
 * per-agent — ADR 0023 forbids ranking agents on pass@1.
 */
const VERDICT_LABEL: Record<QualificationVerdict, { label: string; bg: string; fg: string }> = {
    qualified: { label: 'QUALIFIED', bg: ATLAS_PALETTE.successSoft, fg: ATLAS_PALETTE.successFg },
    running: { label: 'RUNNING…', bg: ATLAS_PALETTE.accentSoft, fg: ATLAS_PALETTE.accentFg },
    failing: { label: 'FAILING', bg: ATLAS_PALETTE.dangerSoft, fg: ATLAS_PALETTE.dangerFg },
    // Amber, not red: nothing is known to be wrong, it is that nothing is known.
    stale: { label: 'STALE', bg: ATLAS_PALETTE.warnSoft, fg: ATLAS_PALETTE.warnFg },
    blocked: { label: 'BLOCKED', bg: ATLAS_PALETTE.warnSoft, fg: ATLAS_PALETTE.warnFg },
    never_run: { label: 'NEVER RUN', bg: ATLAS_PALETTE.slate06, fg: ATLAS_PALETTE.slate60 },
    no_tests: { label: 'NO TESTS', bg: ATLAS_PALETTE.slate06, fg: ATLAS_PALETTE.slate60 },
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ ...META, mb: 0.5 }}>{label}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{children}</Typography>
        </Box>
    );
}

function Qualification({
    q,
    agentId,
    projectId,
    repoId,
}: {
    q: AgentQualification;
    agentId: string;
    projectId: string;
    repoId: string;
}) {
    const runSuite = useRunAgentSuite(agentId);
    const { data: estimate } = useAgentCostEstimate(agentId, q.fixtures);
    const toast = useToast();
    const v = VERDICT_LABEL[q.verdict];

    return (
        <InfoPanel
            label="Qualification"
            headerRight={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: v.fg,
                            background: v.bg,
                            borderRadius: '6px',
                            px: 1.5,
                            py: 0.5,
                        }}
                    >
                        {v.label}
                    </Typography>
                    {q.fixtures > 0 && (
                        <Button
                            size="small"
                            variant="outlined"
                            disabled={runSuite.isPending}
                            onClick={() =>
                                runSuite.mutate(
                                    projectId ? { project_id: projectId, repo_id: repoId || null } : { sandbox: true },
                                    {
                                        onSuccess: () => toast.show({ message: `${q.fixtures} tests started` }),
                                        onError: (e) => toast.show({ message: (e as Error).message }),
                                    },
                                )
                            }
                        >
                            {runSuite.isPending
                                ? 'Starting…'
                                : estimate?.estimated_total_usd != null
                                  ? `Run all ${q.fixtures} · ~${formatCostUsd(estimate.estimated_total_usd)}`
                                  : `Run all ${q.fixtures}`}
                        </Button>
                    )}
                </Box>
            }
        >
            {q.fixtures === 0 ? (
                <Typography sx={META}>
                    Nothing here has been proven. A test runs this agent on a throwaway item and checks the outcome.
                </Typography>
            ) : (
                <>
                    <Box
                        sx={{
                            display: 'grid',
                            gap: 2,
                            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
                        }}
                    >
                        <Stat label="pass@1">
                            {q.passed_at_1} of {q.fixtures} fixtures
                        </Stat>
                        <Stat label="pass@k">
                            {q.passed_at_k} of {q.fixtures}
                            {q.flaky > 0 ? ` · ${q.flaky} flaky` : ''}
                        </Stat>
                        <Stat label="Last run">
                            {q.last_run_at ? relativeTime(q.last_run_at) : 'never'}
                            {q.cost_usd > 0 ? ` · ${formatCostUsd(q.cost_usd)}` : ''}
                        </Stat>
                        {q.ran_at_config && (
                            <Stat label="Proven on">
                                {q.ran_at_config.model ?? 'unrecorded'} · {q.ran_at_config.effort ?? 'unrecorded'} ·
                                prompt v{q.ran_at_config.prompt_version ?? '?'}
                            </Stat>
                        )}
                    </Box>
                    {/* The actionable half of a stale badge. "Something changed"
                        is a shrug; naming the field is a next step. */}
                    {q.stale_reason && (
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.warnFg, mt: 2 }}>
                            {q.stale_reason} — re-run to re-qualify.
                        </Typography>
                    )}
                    {q.never_run > 0 && !q.stale_reason && (
                        <Typography sx={{ ...META, mt: 2 }}>
                            {q.never_run} of {q.fixtures} have never run.
                        </Typography>
                    )}
                </>
            )}
        </InfoPanel>
    );
}

/** Where an adopted fixture stands relative to the bundle it came from. */
const PROVENANCE: Record<string, string> = {
    catalog: 'Ships with this agent · upgrades with it',
    edited: 'Edited by you · upgrades will not change it',
    owner: 'Yours',
};

/** "Run 5× · ~$1.20" — the TOTAL, fetched only while the menu is open. */
function RunSamplesItem({ agentId, n, onRun }: { agentId: string; n: number; onRun: (n: number) => void }) {
    const { data: estimate } = useAgentCostEstimate(agentId, n);
    return (
        <MenuItem onClick={() => onRun(n)}>
            Run {n}×
            {estimate?.estimated_total_usd != null ? ` · ~${formatCostUsd(estimate.estimated_total_usd)}` : ''}
        </MenuItem>
    );
}

interface TestRowProps {
    test: AgentTest;
    agentId: string;
    projectId: string;
    repoId: string;
    provenance: string | undefined;
    onEdit: (t: AgentTest) => void;
}

/**
 * One test. Memoised: the list re-renders on every poll and every SSE event,
 * and a row whose test did not change has nothing to redraw.
 */
const TestRow = memo(function TestRow({ test, agentId, projectId, repoId, provenance, onEdit }: TestRowProps) {
    const [open, setOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuAnchor = useRef<HTMLButtonElement | null>(null);
    const runTest = useRunAgentTest();
    const removeTest = useDeleteAgentTest(agentId);
    const { data: estimate } = useAgentCostEstimate(agentId, 1);
    const toast = useToast();
    const last = test.latest_batch ?? null;
    const checks = useMemo(() => expectationSummary(test.expectations), [test.expectations]);

    const run = (samples: number) => {
        setMenuOpen(false);
        runTest.mutate(
            {
                testId: test.id,
                n_runs: samples,
                ...(projectId ? { project_id: projectId } : { sandbox: true }),
                ...(projectId && repoId ? { repo_id: repoId } : {}),
            },
            {
                onSuccess: () => toast.show({ message: samples > 1 ? `${samples} runs started` : 'Test started' }),
                onError: (e) => toast.show({ message: (e as Error).message }),
            },
        );
    };
    const stop = (fn: () => void) => (e: MouseEvent) => {
        e.stopPropagation();
        fn();
    };

    return (
        <Box sx={{ borderTop: `1px solid ${ATLAS_PALETTE.slate06}`, '&:first-of-type': { borderTop: 0 } }}>
            <Box
                role="button"
                tabIndex={0}
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} history for ${test.name}`}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    setOpen((v) => !v);
                }}
                sx={{
                    display: 'grid',
                    gridTemplateColumns: COLUMNS,
                    gridTemplateAreas: AREAS,
                    alignItems: 'center',
                    columnGap: 2,
                    rowGap: 1,
                    py: 1.5,
                    px: 1,
                    mx: -1,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    '&:hover': { background: ATLAS_PALETTE.cloud },
                    '&:focus-visible': { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: '-2px' },
                }}
            >
                <Box sx={{ gridArea: 'name', minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{
                                fontSize: 18,
                                color: ATLAS_PALETTE.slate40,
                                transform: open ? 'rotate(90deg)' : 'none',
                                transition: 'transform 120ms ease',
                            }}
                        >
                            chevron_right
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {test.name}
                        </Typography>
                    </Box>
                    <Box sx={{ pl: '21px' }}>
                        <Typography sx={{ ...META, mt: 0.25 }}>
                            {test.item_template.issue_type === 'sub_task' ? 'Sub-task' : 'Task'}: {test.item_template.title}
                            {test.expectations.outcome_kind ? ` · expects ${test.expectations.outcome_kind}` : ''}
                        </Typography>
                        {/* A test whose assertions you cannot see is half a test. */}
                        {checks.length > 0 && (
                            <Typography
                                sx={{
                                    ...META,
                                    mt: 0.25,
                                    display: '-webkit-box',
                                    WebkitLineClamp: open ? 'none' : 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}
                            >
                                Checks: {checks.join(' · ')}
                            </Typography>
                        )}
                        {/* Whose fixture this is: it decides whether an upgrade may rewrite it. */}
                        {provenance && (
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40, mt: 0.25 }}>
                                {PROVENANCE[provenance] ?? provenance}
                            </Typography>
                        )}
                    </Box>
                </Box>
                <Box sx={{ gridArea: 'verdict', minWidth: 0, pl: { xs: '21px', md: 0 } }}>
                    {last ? <BatchVerdict batch={last} /> : <Typography sx={META}>Never run</Typography>}
                </Box>
                <Box sx={{ gridArea: 'samples', display: { xs: 'none', md: 'block' } }}>
                    {last && <SampleDots batch={last} />}
                </Box>
                <Typography sx={{ ...META, gridArea: 'last', display: { xs: 'none', md: 'block' } }}>
                    {last ? relativeTime(last.created_at) : '—'}
                </Typography>
                <Typography sx={{ ...MONO, gridArea: 'cost', display: { xs: 'none', md: 'block' } }}>
                    {last && last.cost_usd > 0 ? formatCostUsd(last.cost_usd) : '—'}
                </Typography>
                <Box sx={{ gridArea: 'actions', display: 'flex', alignItems: 'center', gap: 0.5, justifySelf: 'end' }}>
                    <Button
                        size="small"
                        variant="outlined"
                        disabled={runTest.isPending}
                        onClick={stop(() => run(1))}
                        sx={{ whiteSpace: 'nowrap' }}
                    >
                        {/* The spend, before the click: surprise cost is what
                            stops people running tests at all (ADR 0023). */}
                        {runTest.isPending
                            ? 'Starting…'
                            : estimate?.estimated_total_usd != null
                              ? `Run · ~${formatCostUsd(estimate.estimated_total_usd)}`
                              : 'Run'}
                    </Button>
                    <IconButton
                        ref={menuAnchor}
                        size="small"
                        aria-label={`More actions for ${test.name}`}
                        onClick={stop(() => setMenuOpen(true))}
                    >
                        <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 20 }}>
                            more_vert
                        </Box>
                    </IconButton>
                </Box>
            </Box>
            {menuOpen && (
                <Menu
                    anchorEl={menuAnchor.current}
                    open
                    onClose={() => setMenuOpen(false)}
                    onClick={(e) => e.stopPropagation()}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                    {SAMPLE_CHOICES.map((n) => (
                        <RunSamplesItem key={n} agentId={agentId} n={n} onRun={run} />
                    ))}
                    <Divider />
                    <MenuItem
                        onClick={() => {
                            setMenuOpen(false);
                            setOpen((v) => !v);
                        }}
                    >
                        {open ? 'Hide history' : 'History'}
                    </MenuItem>
                    <MenuItem
                        onClick={() => {
                            setMenuOpen(false);
                            onEdit(test);
                        }}
                    >
                        Edit
                    </MenuItem>
                    <MenuItem
                        onClick={() => {
                            setMenuOpen(false);
                            removeTest.mutate(test.id);
                        }}
                        sx={{ color: ATLAS_PALETTE.dangerFg }}
                    >
                        Delete
                    </MenuItem>
                </Menu>
            )}
            {open && (
                <Box sx={{ pl: '21px', pb: 1.5 }}>
                    <TestHistory testId={test.id} />
                </Box>
            )}
        </Box>
    );
});

function ColumnHeads() {
    const head = { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: ATLAS_PALETTE.slate60 } as const;
    return (
        <Box
            sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: COLUMNS.md,
                columnGap: 2,
                pb: 1,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
            }}
        >
            <Typography sx={{ ...head, pl: '21px' }}>Test</Typography>
            <Typography sx={head}>Verdict</Typography>
            <Typography sx={head}>Samples</Typography>
            <Typography sx={head}>Last run</Typography>
            <Typography sx={head}>Cost</Typography>
            <Box />
        </Box>
    );
}

/**
 * The tests this agent shipped with (ADR 0023 phase 4). Templates rather than
 * rows: a test needs a project and a repo, and a catalog bundle has neither.
 * Hidden once every one of them has been adopted.
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
        <InfoPanel label="Ships with this agent">
            <Typography sx={{ ...META, mb: 1 }}>Add makes your own copy. Upgrades never change it.</Typography>
            {available.map((t) => (
                <Box
                    key={t.id}
                    sx={{
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                        py: 1.5,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                        '&:first-of-type': { borderTop: 0 },
                    }}
                >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{t.name}</Typography>
                        {/* What it asserts; the rationale is a hover, not an essay. */}
                        <Typography title={t.notes} sx={META}>
                            {expectationSummary(t.expectations).join(' · ')}
                        </Typography>
                    </Box>
                    <Button size="small" variant="outlined" onClick={() => onAdopt(t)} sx={{ flexShrink: 0 }}>
                        Add
                    </Button>
                </Box>
            ))}
        </InfoPanel>
    );
}

/**
 * Where this agent's fixtures run. Remembered in `localStorage` because it is a
 * property of how the Owner works, not of the test.
 *
 * ponytail: per-browser. To make a fixture always run somewhere specific, PATCH
 * its `project_id` — the column is still there.
 */
const SUITE_PROJECT_KEY = 'atlas.agent-tests.project';
const SUITE_REPO_KEY = 'atlas.agent-tests.repo';

function remembered(key: string): string {
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

function remember(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* a private window is not a reason to break the page */
    }
}

export function TestsTabContent({ agent }: { agent: IAgent }) {
    const { data: tests, isLoading } = useAgentTests(agent.id);
    const { data: starters = [] } = useStarterTests(agent.id);
    const { data: projects } = useProjects();
    const { data: qualification } = useAgentQualification(agent.id);

    const [suiteProject, setSuiteProject] = useState(() => remembered(SUITE_PROJECT_KEY));
    const [suiteRepo, setSuiteRepo] = useState(() => remembered(SUITE_REPO_KEY));
    const { data: suiteRepos } = useProjectRepos(suiteProject);

    /** What the form is doing, or null while it is closed. */
    const [form, setForm] = useState<{ source: TestFormSource; key: number } | null>(null);
    const openForm = useCallback((source: TestFormSource) => setForm({ source, key: Date.now() }), []);
    const onEdit = useCallback((t: AgentTest) => openForm({ kind: 'edit', test: t }), [openForm]);
    const onAdopt = useCallback((t: StarterTest) => openForm({ kind: 'adopt', starter: t }), [openForm]);

    const provenance = useMemo(
        () => new Map((qualification?.[0]?.per_fixture ?? []).map((f) => [f.agent_test_id, f.provenance])),
        [qualification],
    );
    const projectList = useMemo(() => (projects ?? []).map((p) => ({ id: p.id, name: p.name })), [projects]);

    return (
        // No padding of its own: `AgentDetail` already pads the tab column.
        <Box sx={{ display: 'grid', gap: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate60, lineHeight: 1.4 }}>
                    Tests
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>· {(tests ?? []).length}</Typography>
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {/* Where a run makes its throwaway item. Never one of the
                        Owner's projects by default: empty means the Tests sandbox. */}
                    <TextField
                        select
                        size="small"
                        label="Run in"
                        value={suiteProject}
                        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                        onChange={(e) => {
                            setSuiteProject(e.target.value);
                            setSuiteRepo('');
                            remember(SUITE_PROJECT_KEY, e.target.value);
                            remember(SUITE_REPO_KEY, '');
                        }}
                        sx={{ minWidth: 180 }}
                    >
                        <MenuItem value="">{SANDBOX_LABEL}</MenuItem>
                        {projectList.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    {(suiteRepos ?? []).length > 1 && (
                        <TextField
                            select
                            size="small"
                            label="Repo"
                            value={suiteRepo}
                            onChange={(e) => {
                                setSuiteRepo(e.target.value);
                                remember(SUITE_REPO_KEY, e.target.value);
                            }}
                            sx={{ minWidth: 140 }}
                        >
                            {(suiteRepos ?? []).map((r) => (
                                <MenuItem key={r.id} value={r.id}>
                                    {r.name}
                                </MenuItem>
                            ))}
                        </TextField>
                    )}
                    <Button
                        variant="contained"
                        sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                        onClick={() => (form ? setForm(null) : openForm({ kind: 'new' }))}
                    >
                        {form ? 'Cancel' : 'New test'}
                    </Button>
                </Box>
            </Box>

            {qualification?.[0] && (
                <Qualification q={qualification[0]} agentId={agent.id} projectId={suiteProject} repoId={suiteRepo} />
            )}

            {form && (
                <TestForm
                    key={form.key}
                    agentId={agent.id}
                    source={form.source}
                    projects={projectList}
                    onDone={() => setForm(null)}
                />
            )}

            {isLoading ? (
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                    <Skeleton variant="rounded" height={72} />
                    <Skeleton variant="rounded" height={72} />
                </Box>
            ) : (tests ?? []).length === 0 ? (
                // No action button: "New test" is already in the header row, and
                // a second control with the same name makes it ambiguous.
                <EmptyState
                    variant="dashed"
                    icon={
                        <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 32 }}>
                            science
                        </Box>
                    }
                    title="No tests yet"
                    description="A test runs this agent on a throwaway item and checks the outcome. Run it again after a prompt change to see what broke."
                />
            ) : (
                <Box
                    sx={{
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        p: '16px 18px',
                    }}
                >
                    <ColumnHeads />
                    {(tests ?? []).map((t) => (
                        <TestRow
                            key={t.id}
                            test={t}
                            agentId={agent.id}
                            projectId={suiteProject}
                            repoId={suiteRepo}
                            onEdit={onEdit}
                            provenance={provenance.get(t.id)}
                        />
                    ))}
                </Box>
            )}

            {/* Below the list: once every shipped test is adopted this strip
                disappears, and an empty tab leads with its own empty state. */}
            <StarterTests starters={starters} existing={tests ?? []} onAdopt={onAdopt} />
        </Box>
    );
}
