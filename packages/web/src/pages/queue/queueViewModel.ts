import type {
    IBug,
    IEpic,
    IStory,
    ISubBug,
    ISubTask,
    IAgent,
    IAgentRun,
    IssueStatus,
    RunStatus,
} from '@atlas/shared';

type QueueItemType = 'epic' | 'story' | 'bug' | 'sub_task' | 'sub_bug';

export interface QueueItem {
    id: string;
    type: QueueItemType;
    displayId: string;
    title: string;
    status: IssueStatus;
    assignee_agent_id: string | null;
    project_id: string | null;
    updated_at: string;
}

// "Running" means an agent is actively working on the item right now. Items in
// `in_review` are NOT running — they completed and need Owner sign-off, so they
// belong in the Waiting-on-You section, not the Running column.
export function isRunningStatus(s: string): boolean {
    return s === 'in_progress';
}
export function isQueuedStatus(s: string): boolean {
    return s === 'ready';
}
export function isWaitingStatus(s: string): boolean {
    return s === 'waiting_for_info' || s === 'in_review';
}

// Issue ids are already Jira-style human keys (CER-7), so the displayId
// is the id itself. Signature kept stable so existing callers don't break.
export function shortId(id: string, _prefix: string): string {
    return id;
}

export function buildQueueItems(args: {
    epics: IEpic[];
    stories: IStory[];
    bugs: IBug[];
    subTasks?: ISubTask[];
    subBugs?: ISubBug[];
    projectIdByStory: Map<string, string | null>;
    projectIdByEpic: Map<string, string | null>;
}): QueueItem[] {
    const out: QueueItem[] = [];
    for (const e of args.epics) {
        out.push({
            id: e.id,
            type: 'epic',
            displayId: shortId(e.id, 'EPC'),
            title: e.title,
            status: e.status,
            assignee_agent_id: e.assignee_agent_id ?? null,
            project_id: e.project_id ?? null,
            updated_at: e.updated_at,
        });
    }
    for (const s of args.stories) {
        out.push({
            id: s.id,
            type: 'story',
            displayId: shortId(s.id, 'STR'),
            title: s.title,
            status: s.status,
            assignee_agent_id: s.assignee_agent_id ?? null,
            project_id: args.projectIdByEpic.get(s.epic_id) ?? null,
            updated_at: s.updated_at,
        });
    }
    for (const b of args.bugs) {
        out.push({
            id: b.id,
            type: 'bug',
            displayId: shortId(b.id, 'BUG'),
            title: b.title,
            status: b.status,
            assignee_agent_id: b.assignee_agent_id ?? null,
            project_id: args.projectIdByEpic.get(b.epic_id) ?? null,
            updated_at: b.updated_at,
        });
    }
    for (const t of args.subTasks ?? []) {
        out.push({
            id: t.id,
            type: 'sub_task',
            displayId: shortId(t.id, 'SUB-T'),
            title: t.title,
            status: t.status,
            assignee_agent_id: t.assignee_agent_id ?? null,
            project_id: args.projectIdByStory.get(t.story_id) ?? null,
            updated_at: t.updated_at,
        });
    }
    for (const t of args.subBugs ?? []) {
        out.push({
            id: t.id,
            type: 'sub_bug',
            displayId: shortId(t.id, 'SUB-B'),
            title: t.title,
            status: t.status,
            assignee_agent_id: t.assignee_agent_id ?? null,
            project_id: args.projectIdByStory.get(t.story_id) ?? null,
            updated_at: t.updated_at,
        });
    }
    return out;
}

export interface AgentQueueSummary {
    agent: IAgent;
    running: QueueItem[]; // currently in-flight on this agent
    queued: QueueItem[]; // waiting in queue for this agent
    nextRunItem: QueueItem | null;
    lastCompletedItem: QueueItem | null;
    lastCompletedAt: string | null;
    lastRun: IAgentRun | null;
    totalAssigned: number;
}

export function summarizeAgents(args: {
    agents: IAgent[];
    items: QueueItem[];
    runsByAgent: Map<string, IAgentRun[]>;
    itemsById: Map<string, QueueItem>;
}): AgentQueueSummary[] {
    return args.agents.map((w) => {
        const mine = args.items.filter((i) => i.assignee_agent_id === w.id);
        const running = mine.filter((i) => isRunningStatus(i.status as string));
        const queued = mine
            .filter((i) => isQueuedStatus(i.status as string))
            .sort((a, b) => a.updated_at.localeCompare(b.updated_at));

        const runs = args.runsByAgent.get(w.id) ?? [];
        const completed = [...runs].filter((r) => r.status === 'completed' || r.status === 'error');
        completed.sort((a, b) =>
            (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)
        );
        const lastRun = completed[0] ?? null;
        const lastCompletedItem = lastRun ? (args.itemsById.get(lastRun.issue_id) ?? null) : null;
        const lastCompletedAt = lastRun?.completed_at ?? lastRun?.created_at ?? null;

        const nextRunItem = running[0] ?? queued[0] ?? null;

        return {
            agent: w,
            running,
            queued,
            nextRunItem,
            lastCompletedItem,
            lastCompletedAt,
            lastRun,
            totalAssigned: mine.length,
        };
    });
}

export { relativeTime as relativeTimeShort } from '../../utils/time.js';

export function formatNextRunDelta(minutes: number): string {
    if (minutes <= 0) return 'running now';
    if (minutes < 60) return `in ${minutes}m`;
    const h = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (h < 24) return rem > 0 ? `in ${h}h ${rem}m` : `in ${h}h`;
    return `in ${Math.floor(h / 24)}d`;
}

export type AgentStatusLabel = 'Running' | 'Idle' | 'Paused' | 'Failed';

export function getAgentStatusLabel(
    summary: AgentQueueSummary,
    errorState: boolean
): AgentStatusLabel {
    if (summary.agent.status === 'inactive') return 'Paused';
    if (errorState) return 'Failed';
    if (summary.running.length > 0) return 'Running';
    return 'Idle';
}

export function lastRunErrored(run: IAgentRun | null): boolean {
    if (!run) return false;
    return run.status === 'error';
}

export function pickRunStatus(runs: IAgentRun[] | undefined): RunStatus | null {
    if (!runs || runs.length === 0) return null;
    for (const r of runs) {
        if (r.status === 'in_progress') return 'in_progress';
    }
    for (const r of runs) {
        if (r.status === 'queued') return 'queued';
    }
    return null;
}
