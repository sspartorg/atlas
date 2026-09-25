import type { AgentCli, IssueType } from '@atlas/shared';

export interface SidenavCounts {
    projects: number;
    tasks: number;
    queue: number;
    agents: number;
    notifications: number;
}

export interface CostSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    run_count: number;
}

// Terminal-session counterpart to CostSummary — keeps `session_count`
// instead of `run_count` so callers can tell the two sources apart at
// the type level.
export interface TerminalCostSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    session_count: number;
}

export interface ProjectCounts {
    open_tasks: number;
    tasks_ready: number;
    tasks_in_flight: number;
    tasks_waiting_info: number;
    costSummary?: CostSummary;
    terminalCostSummary?: TerminalCostSummary;
}

type AgentCategoryKey = 'software-dev' | 'marketing' | 'content' | 'design';

interface CategoryStat {
    running: number;
}

export type AgentStatsByCategory = Record<AgentCategoryKey, CategoryStat>;

export interface TodaysPassItem {
    run_id: string;
    agent_id: string;
    agent_name: string;
    agent_category: AgentCategoryKey;
    agent_accent_color: string;
    issue_type: string;
    issue_id: string;
    completed_at: string;
}

export interface TodaysPass {
    items: TodaysPassItem[];
    total: number;
}

interface DashboardKpis {
    activeAgents: number;
    doneThisWeek: number;
    projectCount: number;
    // True totals — `awaiting` / `queue` are capped at 20 for rendering.
    awaitingTotal?: number;
    inMotionTotal?: number;
    agentStatsByCategory: AgentStatsByCategory;
    todaysPass: TodaysPass;
    costSummary30d?: CostSummary;
    terminalCostSummary30d?: TerminalCostSummary;
}


export interface AwaitingItem {
    issue_type: IssueType;
    id: string;
    title: string;
    status: string;
    updated_at: string;
}

export interface QueueItem {
    issue_type: IssueType;
    id: string;
    title: string;
    status: string;
    updated_at: string;
    assignee_agent_id: string | null;
    agent_name: string | null;
    accent_color: string | null;
}

export interface DashboardResponse {
    kpis: DashboardKpis;
    awaiting: AwaitingItem[];
    queue: QueueItem[];
}

interface AnalyticsDailyRow {
    date: string;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
    // Terminal-session aggregates for the same day (closed sessions only,
    // bucketed by closed_at in the viewer's tz). Token sums let the
    // dedicated terminal Daily card stack Input/Output/Cached the same
    // way the agentic Daily card does.
    terminal_total_cost_usd: number;
    terminal_session_count: number;
    terminal_input_tokens: number;
    terminal_output_tokens: number;
    terminal_cache_read_tokens: number;
}

interface AnalyticsAgentRow {
    agent_id: string;
    agent_name: string;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    run_count: number;
}

interface AnalyticsProjectRow {
    project_id: string | null;
    project_name: string;
    total_cost_usd: number;
    run_count: number;
}

interface AnalyticsTopRun {
    run_id: string;
    agent_id: string;
    agent_name: string;
    issue_type: string;
    issue_id: string | null;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    created_at: string;
}

interface AnalyticsMonthlyRow {
    month: string; // YYYY-MM
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
    // Terminal-session aggregates for the same month (closed only).
    terminal_total_cost_usd: number;
    terminal_session_count: number;
}

// Per-CLI terminal-session breakdown for the current month. Surfaces the
// claude vs copilot split on the dedicated "Manual terminal sessions"
// card and powers the per-CLI bar inside it.
interface AnalyticsTerminalByCliRow {
    cli: AgentCli;
    total_cost_usd: number;
    session_count: number;
    input_tokens: number;
    output_tokens: number;
}

// Per-project terminal-session breakdown for the current month. Lets the
// existing Cost by Project bars split each project bar into agent vs
// terminal segments.
interface AnalyticsTerminalByProjectRow {
    project_id: string | null;
    // Null for standalone sessions — they have no project to left-join to.
    project_name: string | null;
    total_cost_usd: number;
    session_count: number;
}

// Top 10 most expensive terminal sessions for the current month. Each
// row deep-links to /terminal/<session_id>/history.
export interface AnalyticsSessionSubagent {
    subagent_key: string;
    source: 'claude_jsonl' | 'copilot_list';
    agent_type: string | null;
    description: string | null;
    spawn_depth: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    cost_usd: number | null;
    is_estimate: boolean;
}

interface AnalyticsTopTerminalSession {
    session_id: string;
    project_id: string | null;
    // Null for standalone sessions — they have no project to left-join to.
    project_name: string | null;
    title: string;
    cli: AgentCli;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    closed_at: string;
    subagents: AnalyticsSessionSubagent[];
}

// Terminal-session aggregates for the current month, matching the shape
// of the existing CostSummary so the Hero can sum the two cleanly.
// `closed_at` is the period anchor (vs agent_runs' `completed_at`).
export interface TerminalCostSummary {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    session_count: number;
}

export interface AnalyticsResponse {
    period: { start: string; end: string };
    summary: CostSummary;
    daily: AnalyticsDailyRow[];
    monthly: AnalyticsMonthlyRow[];
    byAgent: AnalyticsAgentRow[];
    byProject: AnalyticsProjectRow[];
    topRuns: AnalyticsTopRun[];
    cacheEfficiency: number;
    // Terminal-session aggregates parallel to `summary` / `byProject` /
    // `topRuns`. The daily + monthly arrays already carry terminal data
    // inline (the chart stacks two bars per day/month).
    terminalSummary: TerminalCostSummary;
    terminalByCli: AnalyticsTerminalByCliRow[];
    terminalByProject: AnalyticsTerminalByProjectRow[];
    topTerminalSessions: AnalyticsTopTerminalSession[];
}

// Per-item cost drill-down. Cost rolls up across the parent/child tree
// in the `items` table via a recursive CTE on items.parent_id; the
// `byKind` block lets the UI split the rollup by item type (task /
// sub_task) without paging through descendant rows.

interface CostTotals {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
}

interface CostByKindRow {
    type: IssueType;
    total_cost_usd: number;
    run_count: number;
    item_count: number;
}

interface ItemCostRow {
    id: string;
    title: string;
    type: IssueType;
    parent_id: string | null;
    depth: number;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
    last_run_at: string | null;
}

export interface AnalyticsProjectResponse {
    project: { id: string; name: string };
    totals: CostTotals;
    byKind: CostByKindRow[];
    /** Top 25 tasks by total cost. Use `/tasks` for the full paginated list. */
    topTasks: Array<{
        id: string;
        title: string;
        descendant_count: number;
        totals: CostTotals;
        last_run_at: string | null;
    }>;
    task_count: number;
    // Terminal-session aggregates scoped to this project (all-time, closed
    // sessions only). Parallel to the page-level analytics response so the
    // drill-down can render the same per-CLI breakdown + top-sessions
    // table for whichever project the Owner clicked through to.
    terminalSummary: TerminalCostSummary;
    terminalByCli: AnalyticsTerminalByCliRow[];
    topTerminalSessions: AnalyticsTopTerminalSession[];
}

export interface AnalyticsProjectTasksResponse {
    rows: Array<{
        id: string;
        title: string;
        descendant_count: number;
        totals: CostTotals;
        last_run_at: string | null;
    }>;
    total: number;
    page: number;
    limit: number;
}

export interface AnalyticsTaskResponse {
    task: { id: string; title: string; project_id: string; project_name: string };
    totals: CostTotals;
    byKind: CostByKindRow[];
    descendant_count: number;
}

export interface AnalyticsTaskChildrenResponse {
    rows: ItemCostRow[];
    total: number;
    page: number;
    limit: number;
}

/**
 * One deterministic gate verdict on a run's timeline.
 *
 * `skipped` is deliberately distinct from `pass`. Both exit 0 and both take the
 * pass edge, and they mean opposite things: `pass` is "I checked and it is
 * fine", `skipped` is "I had nothing I could check". Collapsing them is how a
 * red suite reached the end of a run behind four green rows, and how
 * `gate-visual` reported a pass on the one golden-set fixture built to
 * exercise it.
 */
export interface GateResultRow {
    id: string;
    node_id: string | null;
    repo_id: string | null;
    repo_name: string | null;
    /** The checker agent for a gate node, or `pre-push`. */
    script_id: string;
    /** ADR 0024 — what Atlas actually ran. Null on rows from before migration 020. */
    command: string | null;
    verdict: 'pass' | 'fail' | 'skipped' | 'unavailable' | 'needs_review';
    exit_code: number | null;
    output_tail: string | null;
    created_at: string;
}

/**
 * A saved test for one agent (ADR 0023).
 *
 * It carries the ITEM the agent should act on, not a prompt: PO Writer refuses
 * anything that is not a Task, Coder needs a sub-task with a repo. A bare
 * prompt cannot exercise them, which is why the Test Run tab has never been
 * usable as a test.
 */
export interface AgentTestItemTemplate {
    issue_type: 'task' | 'sub_task';
    title: string;
    description?: string;
    acceptance_criteria?: string;
    labels?: string[];
}

export interface AgentTestExpectations {
    /** `asked_question` is a pass when that is what the agent should do. */
    outcome_kind?: 'done' | 'rejected' | 'asked_question';
    required_checklist_all_passed?: boolean;
    summary_contains?: string[];
    summary_omits?: string[];
    max_cost_usd?: number;
    max_duration_s?: number;
    /** ADR 0023 phase 3 — a workflow eval's assertions about the whole delivery. */
    terminal_status?: string[];
    min_sub_tasks?: number;
    /** `false` is a real assertion: inventing a feature shows up as a PR. */
    requires_pr?: boolean;
    gate_verdicts_all_pass?: boolean;
    /** Migration 017 — what the run DID. Unanswerable here is `errored`, never a pass. */
    tools_required?: string[];
    tools_forbidden?: string[];
    max_turns?: number;
    max_tool_calls?: number;
    files_touched?: string[];
    files_untouched?: string[];
    /** Pass criteria in your own words, graded by a cheap fixed model. Off unless set. */
    judge_criteria?: string[];
}

export interface AgentTest {
    id: string;
    /** Exactly one of `agent_id` / `workflow_id` is set (migration 019). */
    agent_id: string | null;
    /** Set when this fixture runs through a whole workflow, not one agent. */
    workflow_id: string | null;
    /** A tag, for grouping fixtures into a set. */
    suite: string | null;
    project_id: string;
    repo_id: string | null;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations: AgentTestExpectations;
    created_at: string;
    updated_at: string;
}

export interface AgentTestRun {
    id: string;
    agent_test_id: string;
    agent_run_id: string | null;
    item_id: string | null;
    /** `errored` is a broken environment, not a failing agent. */
    verdict: 'running' | 'passed' | 'failed' | 'errored';
    failures: string[];
    cost_usd: number | null;
    duration_s: number | null;
    created_at: string;
    /** Migration 018 — one press of Run is a batch of n of these. */
    batch_id: string;
    sample_index: number;
    label: string | null;
    judge_verdict: 'pass' | 'fail' | 'abstained' | null;
    judge_reason: string | null;
    judge_cost_usd: number | null;
    /** Set for a workflow eval; the run it is judged on. */
    workflow_run_id: string | null;
}

/** A fixture waiting on an Owner answer (ATL-173). */
export interface ParkedFixture {
    run_id: string;
    agent_test_id: string;
    test_name: string;
    workflow_run_id: string;
    item_id: string | null;
    parked_node_id: string | null;
    park_reason: string | null;
    started_at: string;
}

/**
 * What n samples of one test add up to.
 *
 * An agent is stochastic, so a single run's verdict was whichever of two
 * answers the Owner happened to press the button on.
 */
export interface AgentTestBatch {
    batch_id: string;
    label: string | null;
    created_at: string;
    n_runs: number;
    passed: number;
    failed: number;
    errored: number;
    running: number;
    /** The first sample. Comparable with every un-sampled run in history. */
    pass_at_1: boolean | null;
    /** Any sample passed — "can it do this at all", not "reliably". */
    pass_at_k: boolean | null;
    /** passed / (n_runs - errored). A broken environment is not a wrong answer. */
    consistency: number | null;
    /** It passed sometimes. The most useful thing a batch can say. */
    flaky: boolean;
    /** Which expectation was unstable, and in how many samples. */
    failure_histogram: Array<{ failure: string; count: number }>;
    cost_usd: number;
    judge_cost_usd: number;
    duration_s_p50: number | null;
    duration_s_p95: number | null;
    runs: AgentTestRun[];
}

export interface AgentCostEstimate {
    /** Null, not zero, when the agent has never run — those differ. */
    estimated_cost_usd: number | null;
    sample_size: number;
    n_runs: number;
    /** What the Owner is about to spend, not what one run costs. */
    estimated_total_usd: number | null;
    /** p25..p75 of the same history, times n. A mean alone reads as a promise. */
    estimated_range_usd: [number, number] | null;
}


// ── Agent performance (ADR 0023 phase 2, ATL-140) ────────────────────────

/**
 * How a step's FIRST dispatch went, split three ways rather than summed.
 *
 * ADR 0023: `pass@1` must not be shown as a bare ranking. On the v4 golden set
 * `agent-release-reviewer` scored 64% **because it rejected four times**, and
 * those rejections were the most valuable thing in the run. So the API does
 * not return a percentage and the page does not compute one.
 */
export interface FirstPass {
    applied: number;
    rejected: number;
    parked: number;
}

export interface AgentPerformance {
    agent_id: string;
    role_id: string | null;
    window: { since: string | null; until: string | null };
    quality: { steps: number; dispatches: number; first_pass: FirstPass; loops: number; gate_catch: number };
    cost: {
        total_usd: number;
        per_step_usd: number | null;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
        cache_hit_pct: number | null;
    };
    latency: { p50_s: number | null; p95_s: number | null; max_s: number | null; ttft_p50_ms: number | null };
    tools: {
        /** Traces exist only from migration 017 on — hence a stated denominator. */
        runs_with_trace: number;
        runs_total: number;
        top: Array<{ name: string; calls: number; runs: number }>;
        avg_turns: number | null;
        avg_tool_calls: number | null;
    };
    by_config: Array<{
        model: string | null;
        effort: string | null;
        steps: number;
        first_pass: FirstPass;
        cost_usd: number;
    }>;
    trend: Array<{ bucket: string; steps: number; first_pass: FirstPass; cost_usd: number; p95_s: number | null }>;
}


/**
 * A test an agent ships with (ADR 0023 phase 4).
 *
 * A template, not a row: `agent_tests` needs a project and a repo, and a
 * catalog bundle has neither. Adopting one writes an ordinary test that is
 * then the Owner's — a bundle upgrade can never clobber it.
 */
export interface StarterTest {
    id: string;
    name: string;
    item_template: AgentTestItemTemplate;
    expectations: AgentTestExpectations;
    needs_repo: boolean;
    /** What this test catches. The part that makes a starter test teach. */
    notes: string;
}
