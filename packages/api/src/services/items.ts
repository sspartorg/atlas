import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import type { EventsLogExecutor } from './events-log.js';
import type { ItemType } from '../db/types.js';
import type { ITask, ISubTask, IssueStatus, IssuePriority } from '@atlas/shared';

// ----------------------------------------------------------------------------
// Row shapes
// ----------------------------------------------------------------------------

export interface IItemRow {
    id: string;
    project_id: string;
    type: ItemType;
    parent_id: string | null;
    parent_type: ItemType | null;
    title: string;
    description: string | null;
    status: IssueStatus;
    assignee_agent_id: string | null;
    workflow_id: string | null;
    reporter_agent_id: string | null;
    priority: IssuePriority | null;
    spec_md: string | null;
    pr_url: string | null;
    points: number | null;
    acceptance_criteria: string | null;
    started_at: string | null;
    // Null until a workflow run provisions a checkout for the item.
    worktree_branch: string | null;
    worktree_path: string | null;
    // Task 1 — free-form labels for filtering. DB default `[]`; never null.
    labels: string[];
    // ADR 0017 — a Task's repos; DB default `[]` (= the primary repo).
    repo_ids: string[];
    created_at: string;
    updated_at: string;
}

// ----------------------------------------------------------------------------
// Projection helpers (items row -> typed per-type interface from @atlas/shared).
// We project on the way OUT so existing route/web contracts stay byte-identical.
// ----------------------------------------------------------------------------

const NN = (v: string | null | undefined): string => v ?? '';

export function rowToTask(r: IItemRow): ITask {
    if (r.type !== 'task') throw new Error(`rowToTask: expected task, got ${r.type}`);
    return {
        id: r.id,
        project_id: r.project_id,
        title: r.title,
        description: NN(r.description),
        status: r.status,
        assignee_agent_id: r.assignee_agent_id,
        workflow_id: r.workflow_id ?? null,
        reporter_agent_id: r.reporter_agent_id,
        priority: r.priority ?? 'normal',
        acceptance_criteria: NN(r.acceptance_criteria),
        spec_md: r.spec_md,
        pr_url: r.pr_url,
        // DB column default is `[]`; never null in practice.
        /* v8 ignore next */
        labels: r.labels ?? [],
        /* v8 ignore next */
        repo_ids: r.repo_ids ?? [],
        worktree_branch: r.worktree_branch,
        worktree_path: r.worktree_path,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

export function rowToSubTask(r: IItemRow): ISubTask {
    if (r.type !== 'sub_task') throw new Error(`rowToSubTask: expected sub_task, got ${r.type}`);
    return {
        id: r.id,
        // FK trigger guarantees parent exists; `?? ''` is a defensive fallback.
        /* v8 ignore next */
        task_id: r.parent_id ?? '',
        title: r.title,
        description: NN(r.description),
        status: r.status,
        assignee_agent_id: r.assignee_agent_id,
        reporter_agent_id: r.reporter_agent_id,
        priority: r.priority ?? 'normal',
        acceptance_criteria: NN(r.acceptance_criteria),
        started_at: r.started_at,
        /* v8 ignore next */
        labels: r.labels ?? [],
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

// ----------------------------------------------------------------------------
// CRUD on items (type-aware)
// ----------------------------------------------------------------------------

export interface CreateItemInput {
    project_id: string;
    type: ItemType;
    parent_id?: string | null;
    title: string;
    description?: string | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    priority?: IssuePriority | undefined;
    spec_md?: string | null | undefined;
    pr_url?: string | null | undefined;
    acceptance_criteria?: string | undefined;

    // Task 1 — free-form labels for filtering.
    labels?: string[] | undefined;
    repo_ids?: string[] | undefined;
}

export async function createItem(input: CreateItemInput): Promise<IItemRow> {
    return await db.transaction().execute(async (trx) => {
        // Resolve project_id from parent if we have one (parent_id IS the same
        // project — items don't cross projects).
        let projectId = input.project_id;
        if (!projectId && input.parent_id) {
            const parent = await trx
                .selectFrom('items')
                .select('project_id')
                .where('id', '=', input.parent_id)
                .executeTakeFirst();
            if (!parent) throw new Error(`Parent ${input.parent_id} not found`);
            projectId = parent.project_id;
        }

        // Allocate issue key
        const counterRow = await trx
            .updateTable('project_issue_counters')
            .set((eb) => ({ last_seq: eb('last_seq', '+', 1) }))
            .where('project_id', '=', projectId)
            .returning('last_seq')
            .executeTakeFirst();
        if (!counterRow) {
            throw new Error(`No project_issue_counters row for project ${projectId}`);
        }
        const projRow = await trx
            .selectFrom('projects')
            .select('issue_key_prefix')
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!projRow) throw new Error(`Project ${projectId} not found`);
        const id = `${projRow.issue_key_prefix}-${counterRow.last_seq}`;

        const inserted = await trx
            .insertInto('items')
            .values({
                id,
                project_id: projectId,
                type: input.type,
                parent_id: input.parent_id ?? null,
                title: input.title,
                description: input.description ?? null,
                status: input.status ?? 'draft',
                assignee_agent_id: input.assignee_agent_id ?? null,
                reporter_agent_id: input.reporter_agent_id ?? null,
                priority: input.priority ?? 'normal',
                spec_md: input.spec_md ?? null,
                pr_url: input.pr_url ?? null,
                acceptance_criteria: input.acceptance_criteria ?? null,
                // Task 1 — pg's default array→param encoding produces
                // Postgres array syntax (`{a,b}`), not JSONB. Stringify
                // explicitly so PG accepts it as a JSONB value.
                labels: JSON.stringify(input.labels ?? []) as never,
                repo_ids: JSON.stringify(input.repo_ids ?? []),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return inserted as unknown as IItemRow;
    });
}

export async function getItem(
    id: string,
    executor: EventsLogExecutor = db,
): Promise<IItemRow | undefined> {
    const row = await executor.selectFrom('items').selectAll().where('id', '=', id).executeTakeFirst();
    return row as unknown as IItemRow | undefined;
}

export async function getItemOfType(id: string, type: ItemType): Promise<IItemRow | undefined> {
    const row = await db
        .selectFrom('items')
        .selectAll()
        .where('id', '=', id)
        .where('type', '=', type)
        .executeTakeFirst();
    return row as unknown as IItemRow | undefined;
}

export interface PatchFields {
    title?: string | undefined;
    description?: string | null | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    priority?: IssuePriority | undefined;
    spec_md?: string | null | undefined;
    pr_url?: string | null | undefined;
    acceptance_criteria?: string | undefined;
    worktree_branch?: string | null | undefined;
    worktree_path?: string | null | undefined;
    // Task 1 — labels.
    labels?: string[] | undefined;
    repo_ids?: string[] | undefined;
}

export async function patchItem(
    id: string,
    fields: PatchFields,
    executor: EventsLogExecutor = db,
): Promise<IItemRow> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) clean[k] = v;
    }
    // Task 1 — same stringify-for-JSONB note as createItem above.
    if (clean['repo_ids'] !== undefined) {
        clean['repo_ids'] = JSON.stringify(clean['repo_ids']);
    }
    if (clean['labels'] !== undefined) {
        clean['labels'] = JSON.stringify(clean['labels']);
    }
    if (Object.keys(clean).length === 0) {
        const row = await getItem(id, executor);
        if (!row) throw new Error(`Item ${id} not found`);
        return row;
    }
    const updated = await executor
        .updateTable('items')
        .set(clean as never)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
    if (!updated) throw new Error(`Item ${id} not found`);

    return updated as unknown as IItemRow;
}

export async function deleteItem(id: string): Promise<void> {
    await db.deleteFrom('items').where('id', '=', id).execute();
}

// Full-text search via the generated tsvector column.
export interface SearchHit {
    id: string;
    type: ItemType;
    title: string;
    description: string;
    status: IssueStatus;
    project_id: string;
    assignee_agent_id: string | null;
    updated_at: string;
    rank: number;
}

// P14 — server-side filtering for the Search page. The route accepts
// the same filter knobs the client previously applied in-memory, so the
// frontend can drop its corpus build and just render whatever comes back.
//
// `q` is optional: a filter-only request (e.g. `type=sub_task&status=ready`)
// is valid and skips the FTS expression entirely. When q is present,
// results are ranked by `ts_rank`; otherwise they're sorted by
// updated_at DESC so the page stays useful as a browse view.
export interface SearchFilters {
    q?: string;
    types?: ItemType[];
    project_ids?: string[];
    agent_ids?: string[];
    status?: IssueStatus;
    /** ISO timestamp lower bound (inclusive) on `updated_at`. */
    updated_after?: string;
    /** ISO timestamp upper bound (exclusive) on `updated_at`. */
    updated_before?: string;
    /**
     * Task 2 — item must carry ALL of these labels (jsonb `@>`
     * containment). Empty array / undefined skips the filter.
     */
    labels?: string[];
}

export async function searchItems(filters: SearchFilters, limit = 50): Promise<SearchHit[]> {
    const q = filters.q?.trim() ?? '';
    const hasQuery = q.length > 0;

    let qb = db.selectFrom('items').select((_eb) => [
        'id',
        'type',
        'title',
        'description',
        'status',
        'project_id',
        'assignee_agent_id',
        'updated_at',
        hasQuery
            ? sql<number>`ts_rank(search_tsv, websearch_to_tsquery('english', ${q}))`.as('rank')
            : sql<number>`0`.as('rank'),
    ]);

    if (hasQuery) {
        qb = qb.where(sql<boolean>`search_tsv @@ websearch_to_tsquery('english', ${q})`);
    }
    if (filters.types && filters.types.length > 0) {
        qb = qb.where('type', 'in', filters.types);
    }
    if (filters.project_ids && filters.project_ids.length > 0) {
        qb = qb.where('project_id', 'in', filters.project_ids);
    }
    if (filters.agent_ids && filters.agent_ids.length > 0) {
        qb = qb.where('assignee_agent_id', 'in', filters.agent_ids);
    }
    if (filters.status) {
        qb = qb.where('status', '=', filters.status);
    }
    if (filters.updated_after) {
        qb = qb.where('updated_at', '>=', filters.updated_after);
    }
    if (filters.updated_before) {
        qb = qb.where('updated_at', '<', filters.updated_before);
    }
    if (filters.labels && filters.labels.length > 0) {
        // Task 2 — labels @> labels_param means "every requested label
        // is present on the row". The GIN index from migration 083
        // makes this cheap.
        const labelsJson = JSON.stringify(filters.labels);
        qb = qb.where(sql<boolean>`labels @> ${labelsJson}::jsonb`);
    }

    qb = hasQuery
        ? qb.orderBy('rank', 'desc').orderBy('updated_at', 'desc')
        : qb.orderBy('updated_at', 'desc');

    const rows = await qb.limit(limit).execute();
    return rows as unknown as SearchHit[];
}
