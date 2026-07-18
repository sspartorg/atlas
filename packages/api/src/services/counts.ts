import { db } from '../db/kysely-client.js';
import type { ICostSummary, ITerminalCostSummary } from '@atlas/shared';

export interface SidenavCounts {
    projects: number;
    epics: number;
    issues: number;
    queue: number;
    agents: number;
    notifications: number;
}

type AgentCategoryKey = 'software-dev' | 'marketing' | 'content' | 'design';

interface CategoryStat {
    queued: number;
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
    epics: number;
    storiesInProgress: number;
    doneThisWeek: number;
    projectCount: number;
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
// without fetching the entire epics / stories / bugs lists client-side.
export interface ProjectCounts {
    open_epics: number;
    epics_ready: number;
    stories_in_flight: number;
    stories_waiting_info: number;
    open_bugs: number;
    bugs_ready: number;
    costSummary: ICostSummary;
    // Manual terminal sessions closed in the same month for this
    // project. Powers the Project Overview AI Cost tile's combined
    // spend display.
    terminalCostSummary: ITerminalCostSummary;
}

export const countsService = {
    async getSidenavCounts(): Promise<SidenavCounts> {
        const [projects, epics, issues, queue, agents, notifications] = await Promise.all([
            db
                .selectFrom('projects')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', '=', 'epic')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', 'in', ['story', 'bug'])
                .executeTakeFirst(),
            // Queue badge counts ready items that are actually queued for
            // an AI agent. Owner-assigned rows (`assignee_agent_id IS NULL`)
            // are excluded because they don't appear in any agent's queue
            // on the Queue page — they belong in "Waiting on You" instead.
            // Without the assignee filter the badge over-counts every
            // unpicked-up item and stops matching what the page renders.
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('type', 'in', ['epic', 'story', 'bug'])
                .where('status', '=', 'ready')
                .where('assignee_agent_id', 'is not', null)
                .executeTakeFirst(),
            db
                .selectFrom('agents')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('status', '=', 'active')
                .executeTakeFirst(),
            db
                .selectFrom('notifications')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('read_at', 'is', null)
                .executeTakeFirst(),
        ]);
        // PG `COUNT(*)` always returns exactly one row; `executeTakeFirst()` on
        // an aggregate query is never undefined. The `?.` null arms are unreachable.
        /* v8 ignore start */
        return {
            projects: Number(projects?.n ?? 0),
            epics: Number(epics?.n ?? 0),
            issues: Number(issues?.n ?? 0),
            queue: Number(queue?.n ?? 0),
            agents: Number(agents?.n ?? 0),
            notifications: Number(notifications?.n ?? 0),
        };
        /* v8 ignore stop */
    },

    async getDashboardKpis(): Promise<DashboardKpis> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const [
            activeAgents,
            epics,
            storiesInProgress,
            doneThisWeek,
            projectCount,
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
                    .where('type', '=', 'epic')
                    .executeTakeFirst(),
                db
                    .selectFrom('items')
                    .select(({ fn }) => fn.countAll<string>().as('n'))
                    .where('type', '=', 'story')
                    .where('status', 'in', ['ready', 'in_progress', 'in_review'])
                    .executeTakeFirst(),
                db
                    .selectFrom('items')
                    .select(({ fn }) => fn.countAll<string>().as('n'))
                    .where('type', '=', 'story')
                    .where('status', '=', 'done')
                    .where('updated_at', '>=', sevenDaysAgo)
                    .executeTakeFirst(),
                db
                    .selectFrom('projects')
                    .select(({ fn }) => fn.countAll<string>().as('n'))
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
            epics: Number(epics?.n ?? 0),
            storiesInProgress: Number(storiesInProgress?.n ?? 0),
            doneThisWeek: Number(doneThisWeek?.n ?? 0),
            projectCount: Number(projectCount?.n ?? 0),
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
        const rows = await db
            .selectFrom('agent_runs as r')
            .innerJoin('agents as a', 'a.id', 'r.agent_id')
            .select(({ fn }) => ['a.category as category', 'r.status as status', fn.countAll<string>().as('n')])
            .where('r.status', 'in', ['queued', 'in_progress'])
            .groupBy(['a.category', 'r.status'])
            .execute();

        const stats: AgentStatsByCategory = {
            'software-dev': { queued: 0, running: 0 },
            marketing: { queued: 0, running: 0 },
            content: { queued: 0, running: 0 },
            design: { queued: 0, running: 0 },
        };
        for (const row of rows) {
            const cat = row.category as AgentCategoryKey;
            // Unreachable from production: PG CHECK constraint on
            // `agents.category` enforces the enum at the DB level, so
            // any joined row's category is guaranteed to be a known key.
            /* v8 ignore next */
            if (!(cat in stats)) continue;
            const n = Number(row.n);
            if (row.status === 'queued') stats[cat].queued = n;
            else if (row.status === 'in_progress') stats[cat].running = n;
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
            openEpics,
            epicsReady,
            storiesInFlight,
            storiesWaitingInfo,
            openBugs,
            bugsReady,
            costRow,
            terminalCostRow,
        ] = await Promise.all([
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'epic')
                .where('status', '!=', 'done')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'epic')
                .where('status', '=', 'ready')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'story')
                .where('status', 'in', ['in_progress', 'in_review'])
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'story')
                .where('status', '=', 'waiting_for_info')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'bug')
                .where('status', '!=', 'done')
                .executeTakeFirst(),
            db
                .selectFrom('items')
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .where('project_id', '=', projectId)
                .where('type', '=', 'bug')
                .where('status', '=', 'ready')
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
                    eb.or([
                        eb('r.project_id', '=', projectId),
                        eb('i.project_id', '=', projectId),
                    ]),
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
            open_epics: Number(openEpics?.n ?? 0),
            epics_ready: Number(epicsReady?.n ?? 0),
            stories_in_flight: Number(storiesInFlight?.n ?? 0),
            stories_waiting_info: Number(storiesWaitingInfo?.n ?? 0),
            open_bugs: Number(openBugs?.n ?? 0),
            bugs_ready: Number(bugsReady?.n ?? 0),
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
