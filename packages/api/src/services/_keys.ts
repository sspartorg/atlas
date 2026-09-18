import { db } from '../db/kysely-client.js';

// Allocates the next per-project issue key (e.g. "PRJ-7"). Reserves the
// counter atomically inside an UPDATE ... RETURNING. Callers that also need
// to INSERT an item should wrap both in a Kysely transaction; for normal
// item creation prefer the integrated path in services/items.ts:createItem.
export async function allocateIssueKey(project_id: string): Promise<string> {
    const counterRow = await db
        .updateTable('project_issue_counters')
        .set((eb) => ({ last_seq: eb('last_seq', '+', 1) }))
        .where('project_id', '=', project_id)
        .returning('last_seq')
        .executeTakeFirst();
    if (!counterRow) {
        throw new Error(`No project_issue_counters row for project ${project_id}`);
    }
    const projRow = await db
        .selectFrom('projects')
        .select('issue_key_prefix')
        .where('id', '=', project_id)
        .executeTakeFirst();
    if (!projRow) {
        throw new Error(`Project ${project_id} not found while allocating issue key`);
    }
    return `${projRow.issue_key_prefix}-${counterRow.last_seq}`;
}
