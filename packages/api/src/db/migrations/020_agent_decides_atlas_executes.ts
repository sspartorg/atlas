import type { Knex } from 'knex';

// ADR 0024 — the agent decides what to check, Atlas executes it.
//
// A gate node used to carry `script_id` into `guardrail_scripts` and run a
// body Atlas wrote. Four of those bodies guessed at the customer's stack: a UI
// file-extension allowlist, a 95% coverage floor with a ratchet file, 100ms and
// 200ms latency budgets, package-manager detection by lockfile. Atlas cannot
// know what a customer points it at, so every one of those was wrong for
// somebody. A gate now carries `agent_id` — a checker that reads the repo and
// names the command that proves the concern — and Atlas runs that command.
//
// Three changes, one file, because they are one decision:
//
//   1. `run_gate_results.command` — what was actually executed. Nullable: rows
//      written before this migration ran a script body that had no command
//      string, and back-filling a synthetic one would be a lie in an audit
//      table. It is also the memo: the latest row for
//      (workflow_run_id, node_id, repo_id) with a command is what lets a
//      fixer loop-back re-run the check without a second dispatch.
//
//   2. `project_repos.verify_command` — the pre-push gate (ADR 0020) no longer
//      hardcodes `coder-tests-green`. Empty string, not null: "not set yet" and
//      "set to nothing" are the same state here, and an empty value parks the
//      run rather than pushing unverified.
//
//   3. Saved graphs. `startWorkflowRun` validates the graph before the first
//      step, so a stored `gate` node still carrying `script_id` would fail
//      validation and brick every installed Delivery workflow. Both
//      `workflows.graph` and `workflow_runs.graph_snapshot` are rewritten —
//      the snapshot too, or a parked run resumes into a node with no agent and
//      parks again forever.
//
// The four script ids below are every gate Atlas has ever shipped
// (`catalog-contract.test.ts` proves `delivery.json` is the only template with
// gate nodes). A hand-built gate pointing at anything else loses its
// `script_id` and gains no `agent_id`: it fails validation with a per-node
// error the builder already renders, and the Owner picks a checker. Atlas does
// not guess which agent they meant.

const CHECKER_FOR_SCRIPT: Record<string, string> = {
    'gate-hygiene': 'agent-hygiene-check',
    'gate-coverage': 'agent-tests-check',
    'gate-perf': 'agent-perf-check',
    'gate-visual': 'agent-visual-check',
};

/** `gate-coverage` measured coverage; the checker runs the suite. */
const NODE_RENAMES: Record<string, string> = { 'gate-coverage': 'gate-tests' };

interface GraphNode {
    id: string;
    type: string;
    agent_id?: string;
    script_id?: string;
    [k: string]: unknown;
}
interface GraphEdge {
    id: string;
    source: string;
    target: string;
    [k: string]: unknown;
}
interface Graph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

function rewriteGraph(graph: Graph): { graph: Graph; changed: boolean; unmapped: string[] } {
    let changed = false;
    const unmapped: string[] = [];
    const renamed = new Map<string, string>();

    for (const n of graph.nodes) {
        if (n.type !== 'gate') continue;
        const scriptId = typeof n.script_id === 'string' ? n.script_id : null;
        delete n.script_id;
        changed = true;
        const checker = scriptId ? CHECKER_FOR_SCRIPT[scriptId] : undefined;
        if (checker) {
            n.agent_id = checker;
        } else if (scriptId) {
            unmapped.push(`${n.id} (${scriptId})`);
        }
        const renamedId = NODE_RENAMES[n.id];
        if (renamedId) {
            renamed.set(n.id, renamedId);
            n.id = renamedId;
        }
    }

    if (renamed.size > 0) {
        for (const e of graph.edges) {
            const s = renamed.get(e.source);
            const t = renamed.get(e.target);
            if (s) e.source = s;
            if (t) e.target = t;
        }
    }
    return { graph, changed, unmapped };
}

async function rewriteColumn(knex: Knex, table: string, column: string): Promise<string[]> {
    const rows = (await knex(table).select('id', column)) as Array<Record<string, unknown>>;
    const unmapped: string[] = [];
    for (const row of rows) {
        const raw = row[column];
        if (!raw) continue;
        const graph = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Graph;
        if (!Array.isArray(graph.nodes)) continue;
        const result = rewriteGraph(graph);
        if (!result.changed) continue;
        unmapped.push(...result.unmapped.map((u) => `${table}:${String(row['id'])} ${u}`));
        await knex(table)
            .where('id', row['id'] as string)
            .update({ [column]: JSON.stringify(result.graph) });
    }
    return unmapped;
}

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE run_gate_results ADD COLUMN IF NOT EXISTS command text`);
    await knex.raw(
        `ALTER TABLE project_repos ADD COLUMN IF NOT EXISTS verify_command text NOT NULL DEFAULT ''`,
    );

    const unmapped = [
        ...(await rewriteColumn(knex, 'workflows', 'graph')),
        ...(await rewriteColumn(knex, 'workflow_runs', 'graph_snapshot')),
    ];
    if (unmapped.length > 0) {
        console.warn(
            `[020] ${unmapped.length} gate node(s) named a script Atlas never shipped and now have no checker. ` +
                `Open each workflow and choose one: ${unmapped.join(', ')}`,
        );
    }
}

export async function down(knex: Knex): Promise<void> {
    // The columns come back out. The graph rewrite does not: the old
    // `script_id` values name seed rows this branch deletes, so restoring them
    // would point every gate at a script that no longer exists.
    await knex.raw(`ALTER TABLE run_gate_results DROP COLUMN IF EXISTS command`);
    await knex.raw(`ALTER TABLE project_repos DROP COLUMN IF EXISTS verify_command`);
}
