import type { IWorkflowEdge, IWorkflowGraph, IWorkflowNode } from '@atlas/shared';

// Tidy up: a deterministic layered layout for a workflow graph.
//
// Every position in a workflow is hand-authored JSON or a drag, and nothing has
// ever arranged them. The shipped templates step y by 130 against 64px-tall
// nodes, put a fixer only 60px under its gate, and sit a fixer and its reviewer
// on the same row — so the pass edge between them drops below both cards, runs
// across and climbs back up, in the same band as every fail line. No amount of
// edge routing fixes a layout that leaves an edge nowhere to go.
//
// No dependency: dagre and elkjs are 25KB and 100KB+ gzipped against a total
// bundle budget with 16KB of headroom. None is needed — a workflow graph is
// capped at 100 nodes and its pass edges are guaranteed acyclic, so the usual
// Sugiyama machinery collapses to a depth-first pass and two traversals.

/** Column pitch. A card is 216 wide, leaving a 104px corridor for edge lanes. */
const COL_W = 320;
/** Row pitch. A card is 64 tall, leaving ~76px for arrowheads and lane turns. */
const ROW_H = 140;

interface Adjacency {
    out: Map<string, IWorkflowEdge[]>;
    ids: Set<string>;
}

function adjacencyOf(graph: IWorkflowGraph): Adjacency {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const out = new Map<string, IWorkflowEdge[]>();
    for (const e of graph.edges) {
        if (!ids.has(e.source) || !ids.has(e.target)) continue; // a dangling edge lays out nothing
        const list = out.get(e.source) ?? [];
        list.push(e);
        out.set(e.source, list);
    }
    // Pass before fail, then by id: the walk below must not depend on the order
    // edges happen to be stored in, or the same graph would tidy two ways.
    for (const list of out.values()) {
        list.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === 'pass' ? -1 : 1));
    }
    return { out, ids };
}

/**
 * The edges that close a loop, by depth-first walk from Start.
 *
 * A repair loop is a genuine cycle — a gate fails out to a fixer, the fixer's
 * reviewer passes back into the gate — so something has to be named the edge
 * that goes backwards. Walking pass edges before fail ones names the *return*,
 * which is the way the loop reads: the branch goes out and comes back.
 */
function backEdges(graph: IWorkflowGraph, startId: string): Set<string> {
    const { out } = adjacencyOf(graph);
    const back = new Set<string>();
    const onStack = new Set<string>();
    const seen = new Set<string>();

    const walk = (id: string): void => {
        seen.add(id);
        onStack.add(id);
        for (const e of out.get(id) ?? []) {
            if (onStack.has(e.target)) back.add(e.id);
            else if (!seen.has(e.target)) walk(e.target);
        }
        onStack.delete(id);
    };

    walk(startId);
    // A node Start cannot reach still needs its own cycles broken.
    for (const n of graph.nodes) if (!seen.has(n.id)) walk(n.id);
    return back;
}

/**
 * Row per node: the longest forward path from Start, so a node always sits
 * below everything that leads to it.
 *
 * The detour rule is what makes a repair loop readable. A gate's fail branch
 * takes two rows (fixer, reviewer) but the trunk would otherwise advance one
 * row per gate, so four consecutive gates' branches land on top of each other
 * in the same column. Treating a loop's return as "the trunk resumes below the
 * branch" pushes the next gate past it, and the loop becomes a clean rectangle
 * beside the trunk instead of a pile.
 */
function rowsOf(graph: IWorkflowGraph, startId: string, cols: Map<string, number>): Map<string, number> {
    const back = backEdges(graph, startId);
    const forward = graph.edges.filter((e) => !back.has(e.id));
    const passTargetOf = new Map<string, string>();
    for (const e of forward) if (e.kind === 'pass') passTargetOf.set(e.source, e.target);

    // For a loop return u → v, the node the trunk goes to after v must clear u.
    // Expressed as an ordinary edge so the longest path finds it.
    //
    // Only for a return out of a *branch* — `col(u) > col(v)`. A retry between
    // two nodes in the same column is not a detour, it is the main line looping
    // back on itself: `release-review --fail--> build` re-runs a third of the
    // workflow. Reserving rows for that would push the whole trunk below its own
    // tail, and the constraint would close a cycle the longest path cannot walk.
    const detours: Array<{ source: string; target: string }> = [];
    for (const e of graph.edges) {
        if (!back.has(e.id)) continue;
        if ((cols.get(e.source) ?? 0) <= (cols.get(e.target) ?? 0)) continue;
        const resumes = passTargetOf.get(e.target);
        if (resumes !== undefined && resumes !== e.source) detours.push({ source: e.source, target: resumes });
    }

    const into = new Map<string, string[]>();
    for (const e of [...forward, ...detours]) {
        into.set(e.target, [...(into.get(e.target) ?? []), e.source]);
    }

    const rows = new Map<string, number>();
    const open = new Set<string>();
    const row = (id: string): number => {
        const memo = rows.get(id);
        if (memo !== undefined) return memo;
        // Back edges are gone, but a cycle among nodes Start never reaches can
        // survive. Laying it out flat beats not laying it out at all.
        if (open.has(id)) return 0;
        open.add(id);
        const parents = into.get(id) ?? [];
        const r = parents.length === 0 ? 0 : Math.max(...parents.map(row)) + 1;
        open.delete(id);
        rows.set(id, r);
        return r;
    };
    for (const n of graph.nodes) row(n.id);
    return rows;
}

/**
 * Column per node: fewest fail-hops from Start, by 0-1 BFS. A pass edge costs
 * nothing and a fail edge costs one, so the trunk is column 0, a gate's fixer
 * is column 1, and the fixer's reviewer inherits column 1 through its own pass
 * edge — which is what puts a repair branch beside the main line, not across it.
 */
function colsOf(graph: IWorkflowGraph, startId: string): Map<string, number> {
    const { out } = adjacencyOf(graph);
    const cols = new Map<string, number>([[startId, 0]]);
    // A plain array as a deque: the graph cap is 100 nodes, so the O(n) shift
    // is cheaper than the structure that would avoid it.
    const queue: string[] = [startId];
    while (queue.length > 0) {
        const id = queue.shift() as string;
        const here = cols.get(id) ?? 0;
        for (const e of out.get(id) ?? []) {
            const next = here + (e.kind === 'fail' ? 1 : 0);
            const known = cols.get(e.target);
            if (known !== undefined && known <= next) continue;
            cols.set(e.target, next);
            if (e.kind === 'fail') queue.push(e.target);
            else queue.unshift(e.target);
        }
    }
    return cols;
}

/**
 * Lay a graph out top to bottom, repair branches to the right.
 *
 * Pure: returns a new graph and mutates nothing, so the caller can keep the
 * previous positions and undo.
 */
export function tidyGraph(graph: IWorkflowGraph): IWorkflowGraph {
    if (graph.nodes.length === 0) return graph;

    const start = graph.nodes.find((n) => n.type === 'start') ?? (graph.nodes[0] as IWorkflowNode);
    // Columns first: whether a loop return earns the trunk extra rows depends
    // on whether it comes back out of a branch or along the main line.
    const cols = colsOf(graph, start.id);
    const rows = rowsOf(graph, start.id, cols);

    // A node Start cannot reach is an invalid graph, not an impossible one.
    // Give each its own column past the rest so they are visible and separate
    // rather than stacked on top of each other at the origin.
    const reached = graph.nodes.filter((n) => cols.has(n.id));
    const widest = reached.length > 0 ? Math.max(...reached.map((n) => cols.get(n.id) ?? 0)) : 0;
    const orphans = graph.nodes.filter((n) => !cols.has(n.id)).map((n) => n.id).sort();
    const col = (id: string) => cols.get(id) ?? widest + 1 + orphans.indexOf(id);

    // Two nodes can still land in the same cell — two fixers off one gate.
    // Sort by id and push the later ones right, so the result does not depend
    // on the order the nodes happen to be stored in.
    const taken = new Set<string>();
    const placed = new Map<string, { x: number; y: number }>();
    for (const node of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const r = rows.get(node.id) ?? 0;
        let c = col(node.id);
        while (taken.has(`${r}:${c}`)) c++;
        taken.add(`${r}:${c}`);
        placed.set(node.id, { x: c * COL_W, y: r * ROW_H });
    }

    return {
        nodes: graph.nodes.map((n): IWorkflowNode => ({ ...n, position: placed.get(n.id) ?? n.position })),
        edges: graph.edges,
    };
}
