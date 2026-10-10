import type { Knex } from 'knex';

// Script steps replace Check (`gate`) steps. A Check named its command through
// an AI checker agent; a Script step carries the command the Owner typed, and
// Atlas runs it with no AI in the loop. Every `gate` node in a saved graph or a
// run snapshot becomes a `script` node with an empty command: the Owner sees
// "needs a command" in the builder, and a run that reaches one parks rather
// than passing silently. Edges and positions are kept as they are.
//
// `project_repos.verify_command` goes too. Verification is now the workflow's
// own Script steps, not a per-repo line that gated every push.

type Node = { id: string; type: string; agent_id?: string; position?: unknown; [k: string]: unknown };
type Graph = { nodes: Node[]; edges: unknown[] };

function upgrade(graph: Graph): { graph: Graph; changed: boolean } {
    let changed = false;
    const nodes = graph.nodes.map((n) => {
        if (n.type !== 'gate') return n;
        changed = true;
        const { agent_id: _agent, script_id: _script, ...rest } = n;
        return { ...rest, type: 'script', command: '' };
    });
    return { graph: { ...graph, nodes }, changed };
}

async function rewriteGraphs(knex: Knex, table: 'workflows' | 'workflow_runs', column: string): Promise<void> {
    const rows = (await knex(table).select('id', column)) as Array<{ id: string } & Record<string, Graph | string>>;
    for (const row of rows) {
        const raw = row[column];
        const graph: Graph = typeof raw === 'string' ? JSON.parse(raw) : (raw as Graph);
        const next = upgrade(graph);
        if (!next.changed) continue;
        await knex(table)
            .where('id', row.id)
            .update({ [column]: JSON.stringify(next.graph) });
    }
}

export async function up(knex: Knex): Promise<void> {
    await rewriteGraphs(knex, 'workflows', 'graph');
    await rewriteGraphs(knex, 'workflow_runs', 'graph_snapshot');
    await knex.raw('ALTER TABLE public.project_repos DROP COLUMN IF EXISTS verify_command');
}

export async function down(knex: Knex): Promise<void> {
    // The graph rewrite is not reversed: a Script step cannot be told apart from
    // one the Owner built on purpose, and a Check's checker agent is gone. The
    // column comes back empty, which is what a repo with no verify command had.
    await knex.raw(`ALTER TABLE public.project_repos ADD COLUMN IF NOT EXISTS verify_command text DEFAULT '' NOT NULL`);
}
