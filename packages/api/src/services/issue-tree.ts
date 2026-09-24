import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { rowToSubTask, rowToTask } from './items.js';
import type {
    IIssueTreeNode,
    IIssueTreeResponse,
    IProject,
    ISubTask,
    ITask,
    IAgent,
} from '@atlas/shared';

interface BuildOpts {
    projectId?: string | undefined;
    // When false (default), items in `done` status whose `updated_at` is older
    // than 7 days are filtered out — keeps the Issues page focused on active
    // work. Set true to bypass the filter (e.g. archived view, search).
    includeArchived?: boolean | undefined;
}

function projectFromRow(r: Record<string, unknown>): IProject {
    return {
        id: r['id'] as string,
        name: r['name'] as string,
        issue_key_prefix: r['issue_key_prefix'] as string,
        description: r['description'] as string,
        status: r['status'] as string,
        guardrails_md: r['guardrails_md'] as string,
        created_at: r['created_at'] as string,
        updated_at: r['updated_at'] as string,
        last_activity_at: r['updated_at'] as string,
    };
}

export async function buildIssueTree(opts: BuildOpts = {}): Promise<IIssueTreeResponse> {
    const { projectId, includeArchived = false } = opts;

    // 1. Pull every item for the scope in one query.
    let itemsQ = db.selectFrom('items_live').selectAll();
    if (projectId) itemsQ = itemsQ.where('project_id', '=', projectId);
    // Archive filter: hide items closed (status=done) more than 7 days ago.
    // `include_archived` bypasses this so the older long-tail is reachable.
    if (!includeArchived) {
        itemsQ = itemsQ.where(
            sql<boolean>`(status <> 'done' OR updated_at >= NOW() - INTERVAL '7 days')`,
        );
    }
    const allItems = await itemsQ.orderBy('updated_at', 'desc').execute();

    const tasks: ITask[] = [];
    const subTasks: ISubTask[] = [];
    for (const r of allItems) {
        if (r.type === 'task') tasks.push(rowToTask(r as never));
        else subTasks.push(rowToSubTask(r as never));
    }

    // 2. Projects + agents — small tables, fetch in full.
    const [projectRows, agentRows] = await Promise.all([
        db.selectFrom('projects').selectAll().execute(),
        db.selectFrom('agents').selectAll().execute(),
    ]);
    const projects = projectRows.map((r) => projectFromRow(r as never));
    const agents = agentRows as unknown as IAgent[];
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    // ── Assemble ───────────────────────────────────────────────────────────
    const childrenByTask = new Map<string, IIssueTreeNode[]>();
    for (const st of subTasks) {
        const task = taskById.get(st.task_id);
        // A sub-task whose Task fell out of scope (archived) drops with it.
        if (!task) continue;
        const project = projectById.get(task.project_id);
        // FK guarantees the project resolves.
        /* v8 ignore next */
        if (!project) continue;
        const arr = childrenByTask.get(task.id) ?? [];
        arr.push({
            id: st.id,
            kind: 'sub_task',
            short_id: st.id,
            title: st.title,
            status: st.status,
            assignee_agent_id: st.assignee_agent_id,
            reporter_agent_id: st.reporter_agent_id,
            created_at: st.created_at,
            updated_at: st.updated_at,
            project_id: project.id,
            project_name: project.name,
            task_id: task.id,
            task_title: task.title,
            children: [],
        });
        childrenByTask.set(task.id, arr);
    }

    const topLevel: IIssueTreeNode[] = [];
    for (const t of tasks) {
        const project = projectById.get(t.project_id);
        // FK guarantees the project resolves.
        /* v8 ignore next */
        if (!project) continue;
        topLevel.push({
            id: t.id,
            kind: 'task',
            short_id: t.id,
            title: t.title,
            status: t.status,
            assignee_agent_id: t.assignee_agent_id,
            reporter_agent_id: t.reporter_agent_id,
            created_at: t.created_at,
            updated_at: t.updated_at,
            project_id: project.id,
            project_name: project.name,
            task_id: null,
            task_title: null,
            children: childrenByTask.get(t.id) ?? [],
        });
    }
    topLevel.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));

    return { projects, agents, tree: topLevel, tasks };
}
