import { db } from '../db/kysely-client.js';
import type { ICostSummary, ITerminalCostSummary } from '@atlas/shared';
import { notificationsService } from './notifications.js';

export interface SidenavCounts {
    projects: number;
    tasks: number;
    sub_tasks: number;
    queue: number;
    agents: number;
    notifications: number;
}

type AgentCategoryKey = 'software-dev' | 'marketing' | 'content' | 'design';

// Agents have no queue of their own (Tasks queue for workflows — see
// `services/workflow-queue.ts`), so the only per-agent number is live runs.
interface CategoryStat {
    running: number;
}

export type AgentStatsByCategory = Record<AgentCategoryKey, CategoryStat>;

interface TodaysPassItem {
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

export interface DashboardKpis {
    activeAgents: number;
    tasks: number;
    tasksInProgress: number;
    doneThisWeek: number;
    projectCount: number;
    // True totals for the two dashboard panels. The `awaiting` / `queue`
    // arrays on the same response are capped at 20 rows for rendering; the
    // greeting and the KPI tile present a GLOBAL figure, so deriving them
    // from `array.length` silently pinned both at 20 once the workspace grew
    // past that. Counted separately here.
    awaitingTotal: number;
    inMotionTotal: number;
    agentStatsByCategory: AgentStatsByCategory;
    todaysPass: TodaysPass;
    costSummary30d: ICostSummary;
    // Manual terminal sessions closed in the same month, aggregated so
    // the Dashboard "AI Cost" tile can show combined (agent + terminal)
    // spend without the FE summing across two queries.
    terminalCostSummary30d: ITerminalCostSummary;
}

// Per-project Overview KPIs. Backs `GET /api/counts/project/:id` so the
// Project Detail Overview tab can render its 4 KPI tiles + their sub-captions
// without fetching the entire task list client-side.
export interface ProjectCounts {
    open_tasks: number;
    tasks_ready: number;
    tasks_in_flight: number;
    tasks_waiting_info: number;
    costSummary: ICostSummary;
    // Manual terminal sessions closed in the same month for this
    // project. Powers the Project Overview AI Cost tile's combined
    // spend display.
    terminalCostSummary: ITerminalCostSummary;
}

export const countsService = {
    async getSidenavCounts(): Promise<SidenavCounts> {
        const [projects, tasks, subTasks, queue, agents, notifications] = await Promise.all([
            db
                .selectFrom('projects')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'task')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'sub_task')
                .executeTakeFirst(),
            // Queue badge = Tasks queued for a workflow + Task runs running
            // now, the same rows the Queue page lists as queued / running
            // (`services/workflow-queue.ts`). Parked runs wait on the Owner
            // and ready Tasks with no workflow go nowhere, so neither counts.
            Promise.all([
                db
                    .selectFrom('items as i')
                    .innerJoin('workflows as w', 'w.id', 'i.workflow_id')
                    .select(({ fn }) => fn.countAll<string>().as('n'))
                    .where('i.type', '=', 'task')
                    .where('i.status', '=', 'ready')
                    .where('w.input_kind', '=', 'item')
                    .where(({ not, exists, selectFrom }) =>
                        not(
                            exists(
                                selectFrom('workflow_runs as wr')
                                    .select('wr.id')
                                    .whereRef('wr.item_id', '=', 'i.id')
                                    .where('wr.status', 'in', ['running', 'waiting_for_owner']),
                            ),
                        ),
                    )
                    .executeTakeFirst(),
                db
                    .selectFrom('workflow_runs')
                    .select(({ fn }) => fn.countAll<string>().as('n'))
                    .where('status', '=', 'running')
                    .where('parent_workflow_run_id', 'is', null)
                    .where('item_id', 'is not', null)
                    .executeTakeFirst(),
            ]).then(([queued, running]) => ({ n: Number(queued?.n ?? 0) + Number(running?.n ?? 0) })),
            // 2026-09-12 — counts ALL agents, not just `status='active'`.
            // The sidenav label is bare "Agents", the badge links to /agents
            // which lists every agent, and /queue's header counts every agent
            // too — so an active-only badge read as "6 agents are missing".
            // Its five siblings (projects, tasks, sub_tasks, queue,
            // notifications) all count every row; this is the odd one out.
            // The active/paused split is still visible per-card and on the
            // Queue page, where it has a label to explain it.
            db
                .selectFrom('agents')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .executeTakeFirst(),
            // F-004 — must be the SAME count the In-App Feed renders, not a
            // bare `read_at is null`. A completion `needs_you` goes stale once
            // its item leaves waiting_for_info/in_review, and the feed drops
            // it; a naive count kept it, so the badge could read 7 over a feed
            // showing 4 with nothing explaining the gap. `countUnread()`
            // already applies the join and the staleness filter — the badge
            // just never called it.
            notificationsService.countUnread(),
        ]);
        // PG `COUNT(*)` always returns exactly one row; `executeTakeFirst()` on
        // an aggregate query is never undefined. The `?.` null arms are unreachable.
        /* v8 ignore start */
        return {
            projects: Number(projects?.n ?? 0),
            tasks: Number(tasks?.n ?? 0),
            sub_tasks: Number(subTasks?.n ?? 0),
            queue: Number(queue?.n ?? 0),
            agents: Number(agents?.n ?? 0),
            notifications,
        };
        /* v8 ignore stop */
    },

    async getDashboardKpis(): Promise<DashboardKpis> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const [
            activeAgents,
            tasks,
            tasksInProgress,
            doneThisWeek,
            projectCount,
            awaitingTotal,
            inMotionTotal,
            costRow,
            terminalCostRow,
        ] = await Promise.all([
            db
                .selectFrom('agents')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('status', '=', 'active')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'task')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'task')
                .where('status', 'in', ['ready', 'in_progress', 'in_review'])
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'task')
                .where('status', '=', 'done')
                .where('updated_at', '>=', sevenDaysAgo)
                .executeTakeFirst(),
            db
                .selectFrom('projects')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .executeTakeFirst(),
            // Same predicates as getAwaitingItems / getQueueItems below,
            // minus their display limit.
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('status', 'in', ['waiting_for_info', 'in_review'])
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('status', '=', 'in_progress')
                .executeTakeFirst(),
            db
                .selectFrom('agent_runs')
                .select(({ fn }) => [
                    fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('input_tokens').as('input_tokens'),
                    fn.sum<string>('output_tokens').as('output_tokens'),
                    fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                    fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                    fn.countAll<string>().as('run_count'),
                ])
                .where('status', '=', 'completed')
                .where('completed_at', '>=', monthStart)
                .executeTakeFirst(),
            // Manual terminal sessions for the same period. Same
            // status-filter discipline as /api/analytics — only
            // sessions that closed cleanly contribute.
            db
                .selectFrom('cli_sessions')
                .select(({ fn }) => [
                    fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('input_tokens').as('input_tokens'),
                    fn.sum<string>('output_tokens').as('output_tokens'),
                    fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                    fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                    fn.countAll<string>().as('session_count'),
                ])
                .where('status', '=', 'closed')
                .where('closed_at', 'is not', null)
                .where('closed_at', '>=', monthStart)
                .executeTakeFirst(),
        ]);
        const [agentStatsByCategory, todaysPass] = await Promise.all([
            this.getAgentCategoryStats(),
            this.getTodaysPass(),
        ]);
        // PG aggregate queries always return one row; `executeTakeFirst()` is
        // never undefined for COUNT/SUM queries. The `?.` null arms are unreachable.
        /* v8 ignore start */
        return {
            activeAgents: Number(activeAgents?.n ?? 0),
            tasks: Number(tasks?.n ?? 0),
            tasksInProgress: Number(tasksInProgress?.n ?? 0),
            doneThisWeek: Number(doneThisWeek?.n ?? 0),
            projectCount: Number(projectCount?.n ?? 0),
            awaitingTotal: Number(awaitingTotal?.n ?? 0),
            inMotionTotal: Number(inMotionTotal?.n ?? 0),
            agentStatsByCategory,
            todaysPass,
            costSummary30d: {
                total_cost_usd: Number(costRow?.total_cost_usd ?? 0),
                input_tokens: Number(costRow?.input_tokens ?? 0),
                output_tokens: Number(costRow?.output_tokens ?? 0),
                cache_read_tokens: Number(costRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(costRow?.cache_creation_tokens ?? 0),
                run_count: Number(costRow?.run_count ?? 0),
            },
            terminalCostSummary30d: {
                total_cost_usd: Number(terminalCostRow?.total_cost_usd ?? 0),
                input_tokens: Number(terminalCostRow?.input_tokens ?? 0),
                output_tokens: Number(terminalCostRow?.output_tokens ?? 0),
                cache_read_tokens: Number(terminalCostRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(terminalCostRow?.cache_creation_tokens ?? 0),
                session_count: Number(terminalCostRow?.session_count ?? 0),
            },
        };
        /* v8 ignore stop */
    },

    async getAgentCategoryStats(): Promise<AgentStatsByCategory> {
        const runningRows = await db
            .selectFrom('agent_runs as r')
            .innerJoin('agents as a', 'a.id', 'r.agent_id')
            .select(({ fn }) => ['a.category as category', fn.countAll<string>().as('n')])
            .where('r.status', '=', 'in_progress')
            .groupBy('a.category')
            .execute();

        const stats: AgentStatsByCategory = {
            'software-dev': { running: 0 },
            marketing: { running: 0 },
            content: { running: 0 },
            design: { running: 0 },
        };
        for (const row of runningRows) {
            const cat = row.category as AgentCategoryKey;
            // Unreachable from production: PG CHECK constraint on
            // `agents.category` enforces the enum at the DB level, so
            // any joined row's category is guaranteed to be a known key.
            /* v8 ignore next */
            if (!(cat in stats)) continue;
            stats[cat].running = Number(row.n);
        }
        return stats;
    },

    async getTodaysPass(): Promise<TodaysPass> {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const rows = await db
            .selectFrom('agent_runs as r')
            .innerJoin('agents as a', 'a.id', 'r.agent_id')
            .innerJoin('items as i', 'i.id', 'r.item_id')
            .select([
                'r.id as run_id',
                'r.agent_id as agent_id',
                'a.name as agent_name',
                'a.category as agent_category',
                'a.accent_color as agent_accent_color',
                'i.type as issue_type',
                'i.id as issue_id',
                'r.completed_at as completed_at',
            ])
            .where('r.status', '=', 'completed')
            .where('r.completed_at', 'is not', null)
            .where('r.completed_at', '>=', startOfDay.toISOString())
            .orderBy('r.completed_at', 'desc')
            .execute();
        return {
            items: rows.map((r) => ({
                run_id: r.run_id as string,
                agent_id: r.agent_id as string,
                agent_name: r.agent_name as string,
                agent_category: r.agent_category as AgentCategoryKey,
                agent_accent_color: r.agent_accent_color as string,
                issue_type: r.issue_type as string,
                issue_id: r.issue_id as string,
                completed_at: r.completed_at as string,
            })),
            total: rows.length,
        };
    },

    async getProjectCounts(projectId: string): Promise<ProjectCounts> {
        const projNow = new Date();
        const projMonthStart = new Date(projNow.getFullYear(), projNow.getMonth(), 1).toISOString();
        const [
            openTasks,
            tasksReady,
            tasksInFlight,
            tasksWaitingInfo,
            costRow,
            terminalCostRow,
        ] = await Promise.all([
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'task')
                .where('status', '!=', 'done')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'task')
                .where('status', '=', 'ready')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'task')
                .where('status', 'in', ['in_progress', 'in_review'])
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'task')
                .where('status', '=', 'waiting_for_info')
                .executeTakeFirst(),
            // Sum cost across all completed runs for items in this project
            // (including project-scope runs via agent_runs.project_id) using
            // a LEFT JOIN through items to capture item-attached runs.
            db
                .selectFrom('agent_runs as r')
                .leftJoin('items as i', 'i.id', 'r.item_id')
                .select(({ fn }) => [
                    fn.sum<string>('r.total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('r.input_tokens').as('input_tokens'),
                    fn.sum<string>('r.output_tokens').as('output_tokens'),
                    fn.sum<string>('r.cache_read_tokens').as('cache_read_tokens'),
                    fn.sum<string>('r.cache_creation_tokens').as('cache_creation_tokens'),
                    fn.countAll<string>().as('run_count'),
                ])
                .where('r.status', '=', 'completed')
                .where('r.completed_at', '>=', projMonthStart)
                .where((eb) =>
                    eb.or([eb('r.project_id', '=', projectId), eb('i.project_id', '=', projectId)])
                )
                .executeTakeFirst(),
            // Terminal-session aggregate scoped to the same project +
            // current month. Powers the AI Cost tile's combined display
            // on the Project Overview tab.
            db
                .selectFrom('cli_sessions')
                .select(({ fn }) => [
                    fn.sum<string>('total_cost_usd').as('total_cost_usd'),
                    fn.sum<string>('input_tokens').as('input_tokens'),
                    fn.sum<string>('output_tokens').as('output_tokens'),
                    fn.sum<string>('cache_read_tokens').as('cache_read_tokens'),
                    fn.sum<string>('cache_creation_tokens').as('cache_creation_tokens'),
                    fn.countAll<string>().as('session_count'),
                ])
                .where('project_id', '=', projectId)
                .where('status', '=', 'closed')
                .where('closed_at', 'is not', null)
                .where('closed_at', '>=', projMonthStart)
                .executeTakeFirst(),
        ]);
        // PG aggregate queries always return one row; `executeTakeFirst()` is
        // never undefined for COUNT/SUM queries. The `?.` null arms are unreachable.
        /* v8 ignore start */
        return {
            open_tasks: Number(openTasks?.n ?? 0),
            tasks_ready: Number(tasksReady?.n ?? 0),
            tasks_in_flight: Number(tasksInFlight?.n ?? 0),
            tasks_waiting_info: Number(tasksWaitingInfo?.n ?? 0),
            costSummary: {
                total_cost_usd: Number(costRow?.total_cost_usd ?? 0),
                input_tokens: Number(costRow?.input_tokens ?? 0),
                output_tokens: Number(costRow?.output_tokens ?? 0),
                cache_read_tokens: Number(costRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(costRow?.cache_creation_tokens ?? 0),
                run_count: Number(costRow?.run_count ?? 0),
            },
            terminalCostSummary: {
                total_cost_usd: Number(terminalCostRow?.total_cost_usd ?? 0),
                input_tokens: Number(terminalCostRow?.input_tokens ?? 0),
                output_tokens: Number(terminalCostRow?.output_tokens ?? 0),
                cache_read_tokens: Number(terminalCostRow?.cache_read_tokens ?? 0),
                cache_creation_tokens: Number(terminalCostRow?.cache_creation_tokens ?? 0),
                session_count: Number(terminalCostRow?.session_count ?? 0),
            },
        };
        /* v8 ignore stop */
    },

    async getAwaitingItems() {
        const rows = await db
            .selectFrom('items')
            .select(['type as issue_type', 'id', 'title', 'status', 'updated_at'])
            .where('status', 'in', ['waiting_for_info', 'in_review'])
            .orderBy('updated_at', 'asc')
            .limit(20)
            .execute();
        return rows;
    },

    async getQueueItems() {
        const rows = await db
            .selectFrom('items as x')
            .leftJoin('agents as a', 'a.id', 'x.assignee_agent_id')
            .select([
                'x.type as issue_type',
                'x.id as id',
                'x.title as title',
                'x.status as status',
                'x.updated_at as updated_at',
                'x.assignee_agent_id as assignee_agent_id',
                'a.name as agent_name',
                'a.accent_color as accent_color',
            ])
            .where('x.status', '=', 'in_progress')
            .orderBy('x.updated_at', 'desc')
            .limit(20)
            .execute();
        return rows;
    },
};
