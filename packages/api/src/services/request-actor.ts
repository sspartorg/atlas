import type { IncomingHttpHeaders } from 'node:http';
import { db } from '../db/kysely-client.js';

/**
 * Acting agent declared by the MCP api-client on create / link writes via
 * `x-atlas-agent-id`. Same trust model as the comments history/prune route:
 * the write-token gate upstream authenticates the caller, the id itself is
 * self-declared. An id that is not a real agent is dropped (Owner
 * attribution) instead of tripping the items / issue_events agent FKs and
 * 500ing after the write already landed.
 */
export async function headerAgentId(headers: IncomingHttpHeaders): Promise<string | null> {
    const raw = headers['x-atlas-agent-id'];
    const id = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!id) return null;
    const row = await db.selectFrom('agents').select('id').where('id', '=', id).executeTakeFirst();
    return row?.id ?? null;
}
