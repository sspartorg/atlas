import type { Knex } from 'knex';

// The workflow canvas now flows top to bottom (a node takes input on top and
// passes out of its bottom; positions anchor a node's top centre). Graphs
// saved left to right are turned a quarter: old columns become rows, old rows
// become columns. Rows are packed tighter than columns were because nodes are
// much wider than tall, and a node that sat on a lower row (an Owner step
// under its agent) stays a little lower, so the connections into and out of
// it keep their direction. Run snapshots are turned too, so old runs draw the
// same way.

type Point = { x: number; y: number };
type Graph = { nodes?: Array<{ position: Point }> } | null;

const ROW_SCALE = 0.55;
const COLUMN_SCALE = 1.5;
const LOWER_ROW_NUDGE = 0.35;

function turn(graph: NonNullable<Graph>): void {
    const nodes = graph.nodes ?? [];
    const top = Math.min(...nodes.map((n) => n.position.y));
    for (const n of nodes) {
        const { x, y } = n.position;
        n.position = { x: Math.round(y * COLUMN_SCALE), y: Math.round(x * ROW_SCALE + (y - top) * LOWER_ROW_NUDGE) };
    }
}

function unturn(graph: NonNullable<Graph>): void {
    const nodes = graph.nodes ?? [];
    const top = Math.min(...nodes.map((n) => n.position.x / COLUMN_SCALE));
    for (const n of nodes) {
        const oldY = n.position.x / COLUMN_SCALE;
        const oldX = (n.position.y - (oldY - top) * LOWER_ROW_NUDGE) / ROW_SCALE;
        n.position = { x: Math.round(oldX), y: Math.round(oldY) };
    }
}

async function relayout(knex: Knex, move: (g: NonNullable<Graph>) => void): Promise<void> {
    for (const [table, column] of [
        ['workflows', 'graph'],
        ['workflow_runs', 'graph_snapshot'],
    ] as const) {
        const rows = (await knex(table).select('id', column)) as Array<Record<string, unknown>>;
        for (const row of rows) {
            const raw = row[column];
            const graph = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Graph;
            if (!graph?.nodes?.length) continue;
            move(graph);
            await knex(table).where('id', row['id'] as string).update({ [column]: JSON.stringify(graph) });
        }
    }
}

export async function up(knex: Knex): Promise<void> {
    await relayout(knex, turn);
}

export async function down(knex: Knex): Promise<void> {
    await relayout(knex, unturn);
}
