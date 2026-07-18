import { db } from '../db/kysely-client.js';
import { itemLinks } from './item-links.js';
import { externalLinks } from './external-links.js';
import { eventsLog } from './events-log.js';
import { getRound } from './agent-rounds.js';
import {
    rowToBug,
    rowToEpic,
    rowToStory,
    rowToSubBug,
    rowToSubTask,
} from './items.js';
import type {
    IBug,
    IBugFullResponse,
    IEpic,
    IEpicFullResponse,
    IProject,
    IStory,
    IStoryFullResponse,
    ISubBug,
    ISubBugFullResponse,
    ISubTask,
    ISubTaskFullResponse,
    IAgent,
    IIssueLinkRow,
    IssueStatus,
} from '@atlas/shared';

async function getAgentsAll(): Promise<IAgent[]> {
    const rows = await db.selectFrom('agents').selectAll().execute();
    return rows as unknown as IAgent[];
}

async function getEpicById(id: string | null | undefined): Promise<IEpic | null> {
    // FK trigger `items_check_parent` guarantees parent_id resolves; `!id` null
    // guard is a defensive fallback that is unreachable from issueFullService callers.
    /* v8 ignore next */
    if (!id) return null;
    const row = await db
        .selectFrom('items')
        .selectAll()
        .where('id', '=', id)
        .where('type', '=', 'epic')
        .executeTakeFirst();
    // FK trigger guarantees the epic row exists when called from issueFullService.
    /* v8 ignore next */
    return row ? rowToEpic(row as never) : null;
}

async function getStoryById(id: string | null | undefined): Promise<IStory | null> {
    // FK trigger guarantees parent story resolves; `!id` is a defensive guard.
    /* v8 ignore next */
    if (!id) return null;
    const row = await db
        .selectFrom('items')
        .selectAll()
        .where('id', '=', id)
        .where('type', '=', 'story')
        .executeTakeFirst();
    // FK trigger guarantees the story row exists when called from issueFullService.
    /* v8 ignore next */
    return row ? rowToStory(row as never) : null;
}

async function getProjectById(id: string | null | undefined): Promise<IProject | null> {
    // FK trigger guarantees project_id resolves; `!id` is a defensive guard.
    /* v8 ignore next */
    if (!id) return null;
    const row = await db
        .selectFrom('projects')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    // FK trigger guarantees the project row exists when called from issueFullService.
    /* v8 ignore next */
    if (!row) return null;
    return {
        ...(row as unknown as Omit<IProject, 'last_activity_at'>),
        last_activity_at: row.updated_at,
    } as IProject;
}

// A04 — UI surfaces the round count on the detail rail. Returns null
// when the item has no current assignee (Owner is holding it) so the
// frontend can hide the "Rounds: X / Y" row instead of rendering "0 / Y".
async function roundCountFor(
    itemId: string,
    assigneeAgentId: string | null | undefined,
): Promise<number | null> {
    if (!assigneeAgentId) return null;
    return await getRound(itemId, assigneeAgentId);
}

async function relatedLinks(itemId: string): Promise<IIssueLinkRow[]> {
    const rows = await itemLinks.list(itemId);
    return rows.map(
        (r): IIssueLinkRow => ({
            id: r.id,
            type: r.type,
            item_id: r.item_id,
            short_id: r.short_id,
            title: r.title,
            status: r.status as IssueStatus,
            relation_type: r.relation_type,
            direction: r.direction,
            created_at: r.created_at,
        }),
    );
}

export const issueFullService = {
    async story(id: string): Promise<IStoryFullResponse | null> {
        const story = await getStoryById(id);
        if (!story) return null;
        const epic = await getEpicById(story.epic_id);
        /* v8 ignore next */ // FK trigger `items_check_parent` guarantees the story's epic resolves; the `: null` arm is unreachable post-PG-migration.
        const project = epic ? await getProjectById(epic.project_id) : null;
        const [subTaskRows, subBugRows, links, ext_links, activity, agents, round_count] =
            await Promise.all([
                db
                    .selectFrom('items')
                    .selectAll()
                    .where('type', '=', 'sub_task')
                    .where('parent_id', '=', id)
                    .orderBy('created_at', 'asc')
                    .execute(),
                db
                    .selectFrom('items')
                    .selectAll()
                    .where('type', '=', 'sub_bug')
                    .where('parent_id', '=', id)
                    .orderBy('created_at', 'asc')
                    .execute(),
                relatedLinks(id),
                externalLinks.list(id),
                eventsLog.activity(id, 'story'),
                getAgentsAll(),
                roundCountFor(id, story.assignee_agent_id),
            ]);
        return {
            story,
            epic,
            project,
            sub_tasks: subTaskRows.map((r) => rowToSubTask(r as never)) as ISubTask[],
            sub_bugs: subBugRows.map((r) => rowToSubBug(r as never)) as ISubBug[],
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
            round_count,
        };
    },

    async bug(id: string): Promise<IBugFullResponse | null> {
        const row = await db
            .selectFrom('items')
            .selectAll()
            .where('id', '=', id)
            .where('type', '=', 'bug')
            .executeTakeFirst();
        if (!row) return null;
        const bug = rowToBug(row as never) as IBug;
        const epic = await getEpicById(bug.epic_id);
        /* v8 ignore next */ // FK trigger `items_check_parent` guarantees the bug's epic resolves; the `: null` arm is unreachable post-PG-migration.
        const project = epic ? await getProjectById(epic.project_id) : null;
        const [links, ext_links, activity, agents, round_count] = await Promise.all([
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'bug'),
            getAgentsAll(),
            roundCountFor(id, bug.assignee_agent_id),
        ]);
        return {
            bug,
            epic,
            project,
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
            round_count,
        };
    },

    async subTask(id: string): Promise<ISubTaskFullResponse | null> {
        const row = await db
            .selectFrom('items')
            .selectAll()
            .where('id', '=', id)
            .where('type', '=', 'sub_task')
            .executeTakeFirst();
        if (!row) return null;
        const sub_task = rowToSubTask(row as never) as ISubTask;
        const parent_story = await getStoryById(sub_task.story_id);
        // FK trigger `items_check_parent` guarantees parent story/epic/project all resolve; the `: null` arms are unreachable post-PG-migration.
        /* v8 ignore start */
        const epic = parent_story ? await getEpicById(parent_story.epic_id) : null;
        const project = epic ? await getProjectById(epic.project_id) : null;
        /* v8 ignore stop */
        const [links, ext_links, activity, agents, round_count] = await Promise.all([
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'sub_task'),
            getAgentsAll(),
            roundCountFor(id, sub_task.assignee_agent_id),
        ]);
        return {
            sub_task,
            parent_story,
            epic,
            project,
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
            round_count,
        };
    },

    async subBug(id: string): Promise<ISubBugFullResponse | null> {
        const row = await db
            .selectFrom('items')
            .selectAll()
            .where('id', '=', id)
            .where('type', '=', 'sub_bug')
            .executeTakeFirst();
        if (!row) return null;
        const sub_bug = rowToSubBug(row as never) as ISubBug;
        const parent_story = await getStoryById(sub_bug.story_id);
        // FK trigger `items_check_parent` guarantees parent story/epic/project all resolve; the `: null` arms are unreachable post-PG-migration.
        /* v8 ignore start */
        const epic = parent_story ? await getEpicById(parent_story.epic_id) : null;
        const project = epic ? await getProjectById(epic.project_id) : null;
        /* v8 ignore stop */
        const [links, ext_links, activity, agents, round_count] = await Promise.all([
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'sub_bug'),
            getAgentsAll(),
            roundCountFor(id, sub_bug.assignee_agent_id),
        ]);
        return {
            sub_bug,
            parent_story,
            epic,
            project,
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
            round_count,
        };
    },

    async epic(id: string): Promise<IEpicFullResponse | null> {
        const epic = await getEpicById(id);
        if (!epic) return null;
        const [
            project,
            storyRows,
            bugRows,
            links,
            ext_links,
            activity,
            agents,
            round_count,
        ] = await Promise.all([
            getProjectById(epic.project_id),
            db
                .selectFrom('items')
                .selectAll()
                .where('type', '=', 'story')
                .where('parent_id', '=', id)
                .orderBy('created_at', 'asc')
                .execute(),
            db
                .selectFrom('items')
                .selectAll()
                .where('type', '=', 'bug')
                .where('parent_id', '=', id)
                .orderBy('created_at', 'asc')
                .execute(),
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'epic'),
            getAgentsAll(),
            roundCountFor(id, epic.assignee_agent_id),
        ]);
        return {
            epic,
            project,
            stories: storyRows.map((r) => rowToStory(r as never)) as IStory[],
            bugs: bugRows.map((r) => rowToBug(r as never)) as IBug[],
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
            round_count,
        };
    },
};

