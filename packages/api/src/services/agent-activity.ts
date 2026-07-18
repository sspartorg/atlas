import { db } from '../db/kysely-client.js';

// Are any agent_runs currently queued or in_progress against an item in the
// given project? Used to guard project-level operations (re-clone, delete)
// while agents are actively working.
export async function isAnyAgentActiveForProject(projectId: string): Promise<boolean> {
    const row = await db
        .selectFrom('agent_runs as r')
        .innerJoin('items as i', 'i.id', 'r.item_id')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('r.status', 'in', ['queued', 'in_progress'])
        .where('i.project_id', '=', projectId)
        .executeTakeFirst();
    // PG COUNT(*) always returns one row; `executeTakeFirst()` is never undefined.
    // The `?.n ?? 0` null arms are unreachable from production code.
    /* v8 ignore next */
    return Number(row?.n ?? 0) > 0;
}
