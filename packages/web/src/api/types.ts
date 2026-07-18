export interface SidenavCounts {
    projects: number;
    epics: number;
    issues: number;
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
    open_epics: number;
    epics_ready: number;
    stories_in_flight: number;
    stories_waiting_info: number;
    open_bugs: number;
    bugs_ready: number;
    costSummary?: CostSummary;
    terminalCostSummary?: TerminalCostSummary;
}

type AgentCategoryKey = 'software-dev' | 'marketing' | 'content' | 'design';

interface CategoryStat {
    queued: number;
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
    epics: number;
    storiesInProgress: number;
    doneThisWeek: number;
    projectCount: number;
    agentStatsByCategory: AgentStatsByCategory;
    todaysPass: TodaysPass;
    costSummary30d?: CostSummary;
    terminalCostSummary30d?: TerminalCostSummary;
}

import type { IssueType } from '@atlas/shared';

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
    month: string;  // YYYY-MM
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
    cli: 'claude' | 'copilot';
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
    project_name: string;
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
    project_name: string;
    title: string;
    cli: 'claude' | 'copilot';
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
// `byKind` block lets the UI split the rollup by item type (epic /
// story / bug / sub_task / sub_bug) without paging through descendant
// rows.

interface CostTotals {
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    run_count: number;
}

interface CostByKindRow {
    type: 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';
    total_cost_usd: number;
    run_count: number;
    item_count: number;
}

interface ItemCostRow {
    id: string;
    title: string;
    type: 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';
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
    /** Top 25 epics by total cost. Use `/epics` for the full paginated list. */
    topEpics: Array<{
        id: string;
        title: string;
        descendant_count: number;
        totals: CostTotals;
        last_run_at: string | null;
    }>;
    epic_count: number;
    // Terminal-session aggregates scoped to this project (all-time, closed
    // sessions only). Parallel to the page-level analytics response so the
    // drill-down can render the same per-CLI breakdown + top-sessions
    // table for whichever project the Owner clicked through to.
    terminalSummary: TerminalCostSummary;
    terminalByCli: AnalyticsTerminalByCliRow[];
    topTerminalSessions: AnalyticsTopTerminalSession[];
}

export interface AnalyticsProjectEpicsResponse {
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

export interface AnalyticsEpicResponse {
    epic: { id: string; title: string; project_id: string; project_name: string };
    totals: CostTotals;
    byKind: CostByKindRow[];
    descendant_count: number;
}

export interface AnalyticsEpicChildrenResponse {
    rows: ItemCostRow[];
    total: number;
    page: number;
    limit: number;
}
