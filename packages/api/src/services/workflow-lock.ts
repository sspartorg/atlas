import type { FastifyInstance } from 'fastify';
import { db } from '../db/kysely-client.js';

// ADR 0014 — while a workflow run is actively working an item, the engine is
// the only writer of that item's status and assignee. Agents used to route
// themselves through MCP `update_item` assign / change_status; letting that
// continue would fight the engine (and a manual UI change would strand the
// run). Stopping the run is the way to take the item back. A parked run
// (`waiting_for_owner`) does not lock the item.
const ITEM_ROUTING_URL = /^\/api\/(?:tasks|sub-tasks)\/([^/?]+)\/(?:status|assign)(?:\?|$)/;

async function runningWorkflowRunOnItem(itemId: string): Promise<string | null> {
    const row = await db
        .selectFrom('workflow_runs')
        .select('id')
        .where('item_id', '=', itemId)
        .where('status', '=', 'running')
        .executeTakeFirst();
    return row?.id ?? null;
}

export function registerWorkflowItemLock(app: FastifyInstance): void {
    app.addHook('preHandler', async (req, reply) => {
        if (req.method !== 'PATCH') return;
        const match = ITEM_ROUTING_URL.exec(req.url);
        if (!match?.[1]) return;
        const runId = await runningWorkflowRunOnItem(decodeURIComponent(match[1]));
        if (!runId) return;
        return reply.status(409).send({
            error: 'A workflow run is working on this item and owns its status and assignee. Report the result with the atlas-outcome block, or stop the workflow run to change it by hand.',
            kind: 'conflict',
            workflow_run_id: runId,
        });
    });
}
