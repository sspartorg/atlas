import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import {
    rowToBug,
    rowToEpic,
    rowToStory,
    rowToSubBug,
    rowToSubTask,
} from './items.js';
import type {
    IBug,
    IEpic,
    IIssueTreeNode,
    IIssueTreeResponse,
    IProject,
    IStory,
    ISubBug,
    ISubTask,
    IssueTreeKind,
    IAgent,
} from '@atlas/shared';

interface BuildOpts {
    projectId?: string | undefined;
    // When false (default), items in `done` status whose `updated_at` is older
    // than 7 days are filtered out — keeps the Issues page focused on active
    // work. Set true to bypass the filter (e.g. archived view, search).
    includeArchived?: boolean | undefined;
}

function shortId(_kind: IssueTreeKind, id: string): string {
    return id;
}

function projectFromRow(r: Record<string, unknown>): IProject {
    return {
        id: r['id'] as string,
        name: r['name'] as string,
        issue_key_prefix: r['issue_key_prefix'] as string,
        git_path: r['git_path'] as string,
        git_url: r['git_url'] as string,
        credential_id: (r['credential_id'] as string | null) ?? null,
        default_branch: r['default_branch'] as string,
        clone_status: r['clone_status'] as IProject['clone_status'],
        description: r['description'] as string,
        status: r['status'] as string,
        guardrails_md: r['guardrails_md'] as string,
        // Column is `NOT NULL DEFAULT ''` (migration 004) — the `?? ''`
        // fallback can never fire against a real row; kept only for the
        // defensive cast from `unknown`.
        /* v8 ignore next */
        setup_sh_body: (r['setup_sh_body'] as string | null) ?? '',
        /* v8 ignore next */
        setup_ps1_body: (r['setup_ps1_body'] as string | null) ?? '',
        created_at: r['created_at'] as string,
        updated_at: r['updated_at'] as string,
        last_activity_at: r['updated_at'] as string,
    };
}

export async function buildIssueTree(opts: BuildOpts = {}): Promise<IIssueTreeResponse> {
    const { projectId, includeArchived = false } = opts;

    // 1. Pull every item for the scope in one query.
    let itemsQ = db.selectFrom('items').selectAll();
    if (projectId) itemsQ = itemsQ.where('project_id', '=', projectId);
    // Archive filter: hide items closed (status=done) more than 7 days ago.
    // `include_archived` bypasses this so the older long-tail is reachable.
    if (!includeArchived) {
        itemsQ = itemsQ.where(
            sql<boolean>`(status <> 'done' OR updated_at >= NOW() - INTERVAL '7 days')`,
        );
    }
    const allItems = await itemsQ.orderBy('updated_at', 'desc').execute();

    const epics: IEpic[] = [];
    const stories: IStory[] = [];
    const subTasks: ISubTask[] = [];
    const subBugs: ISubBug[] = [];
    const bugs: IBug[] = [];
    for (const r of allItems) {
        switch (r.type) {
            case 'epic':
                epics.push(rowToEpic(r as never));
                break;
            case 'story':
                stories.push(rowToStory(r as never));
                break;
            case 'sub_task':
                subTasks.push(rowToSubTask(r as never));
                break;
            case 'sub_bug':
                subBugs.push(rowToSubBug(r as never));
                break;
            case 'bug':
                bugs.push(rowToBug(r as never));
                break;
        }
    }

    const epicById = new Map(epics.map((e) => [e.id, e]));
    const storyById = new Map(stories.map((s) => [s.id, s]));

    // 2. Projects + agents — small tables, fetch in full.
    const [projectRows, agentRows] = await Promise.all([
        db.selectFrom('projects').selectAll().execute(),
        db.selectFrom('agents').selectAll().execute(),
    ]);
    const projects = projectRows.map((r) => projectFromRow(r as never));
    const agents = agentRows as unknown as IAgent[];
    const projectById = new Map(projects.map((p) => [p.id, p]));

    // ── Assemble ───────────────────────────────────────────────────────────
    const childrenByStory = new Map<string, IIssueTreeNode[]>();
    for (const t of subTasks) {
        const story = storyById.get(t.story_id);
        // FK trigger guarantees parent story resolves.
        /* v8 ignore next */
        if (!story) continue;
        const epic = epicById.get(story.epic_id);
        // FK trigger guarantees epic resolves; the `: undefined` arm is unreachable post-PG-migration.
        /* v8 ignore next */
        const project = epic ? projectById.get(epic.project_id) : undefined;
        // FK trigger guarantees epic+project resolve.
        /* v8 ignore next */
        if (!epic || !project) continue;
        const node: IIssueTreeNode = {
            id: t.id,
            kind: 'sub_task',
            short_id: shortId('sub_task', t.id),
            title: t.title,
            status: t.status,
            assignee_agent_id: t.assignee_agent_id,
            reporter_agent_id: t.reporter_agent_id,
            created_at: t.created_at,
            updated_at: t.updated_at,
            project_id: project.id,
            project_name: project.name,
            epic_id: epic.id,
            epic_title: epic.title,
            parent_story_id: story.id,
            parent_story_title: story.title,
            children: [],
        };
        const arr = childrenByStory.get(story.id) ?? [];
        arr.push(node);
        childrenByStory.set(story.id, arr);
    }
    for (const b of subBugs) {
        const story = storyById.get(b.story_id);
        // FK trigger guarantees parent story resolves.
        /* v8 ignore next */
        if (!story) continue;
        const epic = epicById.get(story.epic_id);
        // FK trigger guarantees epic resolves; the `: undefined` arm is unreachable post-PG-migration.
        /* v8 ignore next */
        const project = epic ? projectById.get(epic.project_id) : undefined;
        // FK trigger guarantees epic+project resolve.
        /* v8 ignore next */
        if (!epic || !project) continue;
        const node: IIssueTreeNode = {
            id: b.id,
            kind: 'sub_bug',
            short_id: shortId('sub_bug', b.id),
            title: b.title,
            status: b.status,
            assignee_agent_id: b.assignee_agent_id,
            reporter_agent_id: b.reporter_agent_id,
            created_at: b.created_at,
            updated_at: b.updated_at,
            project_id: project.id,
            project_name: project.name,
            epic_id: epic.id,
            epic_title: epic.title,
            parent_story_id: story.id,
            parent_story_title: story.title,
            children: [],
        };
        const arr = childrenByStory.get(story.id) ?? [];
        arr.push(node);
        childrenByStory.set(story.id, arr);
    }

    const topLevel: IIssueTreeNode[] = [];
    for (const s of stories) {
        const epic = epicById.get(s.epic_id);
        // FK trigger guarantees epic resolves; the `: undefined` arm is unreachable post-PG-migration.
        /* v8 ignore next */
        const project = epic ? projectById.get(epic.project_id) : undefined;
        // FK trigger `items_check_parent` guarantees epic+project resolve.
        /* v8 ignore next */
        if (!epic || !project) continue;
        topLevel.push({
            id: s.id,
            kind: 'story',
            short_id: shortId('story', s.id),
            title: s.title,
            status: s.status,
            assignee_agent_id: s.assignee_agent_id,
            reporter_agent_id: s.reporter_agent_id,
            created_at: s.created_at,
            updated_at: s.updated_at,
            project_id: project.id,
            project_name: project.name,
            epic_id: epic.id,
            epic_title: epic.title,
            parent_story_id: null,
            parent_story_title: null,
            children: childrenByStory.get(s.id) ?? [],
        });
    }
    for (const b of bugs) {
        const epic = epicById.get(b.epic_id);
        // FK trigger guarantees epic resolves; the `: undefined` arm is unreachable post-PG-migration.
        /* v8 ignore next */
        const project = epic ? projectById.get(epic.project_id) : undefined;
        // FK trigger `items_check_parent` guarantees epic+project resolve.
        /* v8 ignore next */
        if (!epic || !project) continue;
        topLevel.push({
            id: b.id,
            kind: 'bug',
            short_id: shortId('bug', b.id),
            title: b.title,
            status: b.status,
            assignee_agent_id: b.assignee_agent_id,
            reporter_agent_id: b.reporter_agent_id,
            created_at: b.created_at,
            updated_at: b.updated_at,
            project_id: project.id,
            project_name: project.name,
            epic_id: epic.id,
            epic_title: epic.title,
            parent_story_id: null,
            parent_story_title: null,
            children: [],
        });
    }
    topLevel.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));

    // The raw arrays travel alongside `tree` so Project Detail can drop
    // its three legacy /api/{epics,stories,bugs}?project_id=… fetches.
    // Already loaded in `allItems` — purely a free roundtrip removal on
    // top of the tree query.
    return { projects, agents, tree: topLevel, epics, stories, bugs };
}
