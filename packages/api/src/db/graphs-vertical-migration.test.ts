import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Knex from 'knex';
import { truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { down, up } from './migrations/039_workflow_graphs_vertical.js';

const knex = Knex({ client: 'pg', connection: process.env['DATABASE_URL'] ?? '', pool: { min: 0, max: 1 } });

afterAll(async () => {
    await knex.destroy();
});

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
});

// A v1 (left-to-right) Planning graph: the Owner step sat under PO Writer.
const HORIZONTAL = {
    nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 120 } },
        { id: 'po', type: 'agent', agent_id: 'agent-po-writer', position: { x: 220, y: 120 } },
        { id: 'owner', type: 'owner', position: { x: 220, y: 320 } },
        { id: 'end', type: 'end', position: { x: 480, y: 120 } },
    ],
    edges: [],
};

const positions = async (trx: Knex.Transaction, table: 'workflows' | 'workflow_runs', column: string) => {
    const row = (await trx(table).select(column).first()) as Record<string, { nodes: Array<{ id: string; position: { x: number; y: number } }> }>;
    return Object.fromEntries((row[column]?.nodes ?? []).map((n) => [n.id, n.position]));
};

describe('migration 039 — workflow graphs flow top to bottom', () => {
    it('turns saved graphs and run snapshots a quarter, keeps lower rows lower, and down() restores them', async () => {
        const trx = await knex.transaction();
        try {
            await trx('workflows').insert({ id: 'wf-1', project_id: 'p1', name: 'Planning', graph: JSON.stringify(HORIZONTAL) });
            await trx('workflow_runs').insert({ id: 'run-1', workflow_id: 'wf-1', project_id: 'p1', graph_snapshot: JSON.stringify(HORIZONTAL) });

            await up(trx);
            for (const [table, column] of [['workflows', 'graph'], ['workflow_runs', 'graph_snapshot']] as const) {
                const p = await positions(trx, table, column);
                // One column for the main line, rows in the old left-to-right order.
                expect(new Set([p['start']?.x, p['po']?.x, p['end']?.x])).toEqual(new Set([180]));
                expect((p['start']?.y ?? 0) < (p['po']?.y ?? 0) && (p['po']?.y ?? 0) < (p['end']?.y ?? 0)).toBe(true);
                // The Owner moves beside PO Writer, and stays below it.
                expect(p['owner']?.x).toBeGreaterThan(p['po']?.x ?? 0);
                expect(p['owner']?.y).toBeGreaterThan(p['po']?.y ?? 0);
            }

            await down(trx);
            expect(await positions(trx, 'workflows', 'graph')).toEqual(
                Object.fromEntries(HORIZONTAL.nodes.map((n) => [n.id, n.position])),
            );
        } finally {
            await trx.rollback();
        }
    });
});
