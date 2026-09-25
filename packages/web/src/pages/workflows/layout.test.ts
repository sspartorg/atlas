import { describe, expect, it } from 'vitest';
import type { IWorkflowGraph, IWorkflowNode } from '@atlas/shared';
import { tidyGraph } from './layout.js';

const ROW_H = 140;
const COL_W = 320;

function node(id: string, type: IWorkflowNode['type'] = 'agent'): IWorkflowNode {
    // Every node starts at the origin, so anything the layout gets right it
    // got right by laying out rather than by leaving positions alone.
    return { id, type, position: { x: 0, y: 0 } };
}

const at = (g: IWorkflowGraph, id: string) => g.nodes.find((n) => n.id === id)!.position;

/** Start → coder → gate → end, with the gate failing out to a fixer that loops back. */
function repairGraph(): IWorkflowGraph {
    return {
        nodes: [node('start', 'start'), node('coder'), node('gate', 'gate'), node('fix'), node('end', 'end')],
        edges: [
            { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
            { id: 'e2', source: 'coder', target: 'gate', kind: 'pass' },
            { id: 'e3', source: 'gate', target: 'end', kind: 'pass' },
            { id: 'e4', source: 'gate', target: 'fix', kind: 'fail' },
            { id: 'e5', source: 'fix', target: 'gate', kind: 'pass' },
        ],
    };
}

describe('tidyGraph', () => {
    it('drops every pass edge exactly one row', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('a'), node('b'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'a', kind: 'pass' },
                { id: 'e2', source: 'a', target: 'b', kind: 'pass' },
                { id: 'e3', source: 'b', target: 'end', kind: 'pass' },
            ],
        });
        for (const e of g.edges) {
            expect(at(g, e.target).y - at(g, e.source).y).toBe(ROW_H);
        }
    });

    it('starts at the top and ends at the bottom', () => {
        const g = tidyGraph(repairGraph());
        expect(at(g, 'start').y).toBe(0);
        expect(at(g, 'end').y).toBe(Math.max(...g.nodes.map((n) => n.position.y)));
    });

    // The whole point: a repair branch runs beside the trunk, not through it.
    it('puts a gate’s fixer one column to the right of the trunk', () => {
        const g = tidyGraph(repairGraph());
        expect(at(g, 'gate').x).toBe(0);
        expect(at(g, 'fix').x).toBe(COL_W);
    });

    // A fixer and its reviewer on the same row is what makes the pass edge
    // between them U-turn under both cards. Inheriting the column through a
    // pass edge keeps the pair stacked vertically instead.
    it('stacks a fixer’s reviewer under it rather than beside it', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('gate', 'gate'), node('fix'), node('review'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'gate', kind: 'pass' },
                { id: 'e2', source: 'gate', target: 'end', kind: 'pass' },
                { id: 'e3', source: 'gate', target: 'fix', kind: 'fail' },
                { id: 'e4', source: 'fix', target: 'review', kind: 'pass' },
                { id: 'e5', source: 'review', target: 'gate', kind: 'pass' },
            ],
        });
        expect(at(g, 'review').x).toBe(at(g, 'fix').x);
        expect(at(g, 'review').y).toBeGreaterThan(at(g, 'fix').y);
    });

    it('never puts two nodes in the same place', () => {
        const g = tidyGraph(repairGraph());
        const seen = g.nodes.map((n) => `${n.position.x}:${n.position.y}`);
        expect(new Set(seen).size).toBe(g.nodes.length);
    });

    // Two fixers off the same gate land at the same depth and the same row.
    it('separates two nodes that would land in the same cell', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('gate', 'gate'), node('fixA'), node('fixB'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'gate', kind: 'pass' },
                { id: 'e2', source: 'gate', target: 'end', kind: 'pass' },
                { id: 'e3', source: 'gate', target: 'fixA', kind: 'fail' },
                { id: 'e4', source: 'gate', target: 'fixB', kind: 'fail' },
                { id: 'e5', source: 'fixA', target: 'gate', kind: 'pass' },
                { id: 'e6', source: 'fixB', target: 'gate', kind: 'pass' },
            ],
        });
        expect(at(g, 'fixA')).not.toEqual(at(g, 'fixB'));
    });

    // An invalid graph still has to be drawn — the Owner cannot delete a
    // connection they cannot see. A pass cycle must terminate, not hang.
    it('lays out a graph with a pass cycle instead of recursing forever', () => {
        const g = tidyGraph({
            nodes: [node('a'), node('b')],
            edges: [
                { id: 'e1', source: 'a', target: 'b', kind: 'pass' },
                { id: 'e2', source: 'b', target: 'a', kind: 'pass' },
            ],
        });
        expect(new Set(g.nodes.map((n) => `${n.position.x}:${n.position.y}`)).size).toBe(2);
    }, 1000);

    it('spills a node Start cannot reach into its own column rather than stacking it', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('end', 'end'), node('orphanB'), node('orphanA')],
            edges: [{ id: 'e1', source: 'start', target: 'end', kind: 'pass' }],
        });
        expect(at(g, 'orphanA')).not.toEqual(at(g, 'orphanB'));
        expect(at(g, 'orphanA').x).toBeGreaterThan(at(g, 'start').x);
        expect(at(g, 'orphanB').x).toBeGreaterThan(at(g, 'start').x);
    });

    // Four gates one row apart, each owing its branch two rows. Sharing one
    // column, the four repair loops landed on top of each other and the
    // collision push shunted half of them into a third column, so every fail
    // edge crossed the branch beside it. The trunk has to make room.
    it('gives each gate’s repair loop rows of its own', () => {
        const gates = ['hygiene', 'coverage', 'perf'];
        const g = tidyGraph({
            nodes: [
                node('start', 'start'),
                node('end', 'end'),
                ...gates.flatMap((k) => [node(`gate-${k}`, 'gate'), node(`fix-${k}`), node(`review-${k}`)]),
            ],
            edges: [
                { id: 'in', source: 'start', target: 'gate-hygiene', kind: 'pass' },
                { id: 'out', source: 'gate-perf', target: 'end', kind: 'pass' },
                { id: 'g1', source: 'gate-hygiene', target: 'gate-coverage', kind: 'pass' },
                { id: 'g2', source: 'gate-coverage', target: 'gate-perf', kind: 'pass' },
                ...gates.flatMap((k) => [
                    { id: `f-${k}`, source: `gate-${k}`, target: `fix-${k}`, kind: 'fail' as const },
                    { id: `p-${k}`, source: `fix-${k}`, target: `review-${k}`, kind: 'pass' as const },
                    { id: `r-${k}`, source: `review-${k}`, target: `gate-${k}`, kind: 'pass' as const },
                ]),
            ],
        });
        const cells = g.nodes.map((n) => `${n.position.x}:${n.position.y}`);
        expect(new Set(cells).size).toBe(g.nodes.length);
        // Every branch stays in one column beside the trunk — never a third.
        expect(new Set(g.nodes.map((n) => n.position.x))).toEqual(new Set([0, COL_W]));
        for (const k of gates) {
            expect(at(g, `fix-${k}`).y).toBe(at(g, `gate-${k}`).y + ROW_H);
            expect(at(g, `review-${k}`).y).toBe(at(g, `gate-${k}`).y + 2 * ROW_H);
        }
    });

    // `release-review --fail--> build` re-runs a third of the delivery
    // workflow. It is the main line looping back on itself, not a branch
    // hanging off it, so it must not push the trunk below its own tail — and
    // reserving rows for it closes a cycle the row walk cannot resolve, which
    // silently flattened every node after it to the top of the graph.
    it('does not reserve rows for a retry along the trunk', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('build'), node('test'), node('review'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'build', kind: 'pass' },
                { id: 'e2', source: 'build', target: 'test', kind: 'pass' },
                { id: 'e3', source: 'test', target: 'review', kind: 'pass' },
                { id: 'e4', source: 'review', target: 'end', kind: 'pass' },
                { id: 'e5', source: 'review', target: 'build', kind: 'fail' },
            ],
        });
        expect(['start', 'build', 'test', 'review', 'end'].map((id) => at(g, id).y)).toEqual([
            0,
            ROW_H,
            2 * ROW_H,
            3 * ROW_H,
            4 * ROW_H,
        ]);
        expect(g.nodes.every((n) => n.position.x === 0)).toBe(true);
    });

    // An Owner answer is the same shape as a repair: the agent fails out to
    // the Owner and the answer comes back in.
    it('hangs an Owner answer loop beside the node that asked', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('po'), node('owner', 'owner'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'po', kind: 'pass' },
                { id: 'e2', source: 'po', target: 'end', kind: 'pass' },
                { id: 'e3', source: 'po', target: 'owner', kind: 'fail' },
                { id: 'e4', source: 'owner', target: 'po', kind: 'pass' },
            ],
        });
        expect(at(g, 'owner')).toEqual({ x: COL_W, y: at(g, 'po').y + ROW_H });
        expect(at(g, 'end').y).toBeGreaterThan(at(g, 'owner').y);
    });

    // Two paths converging on one node: the walk must recognise the second
    // arrival as already-seen rather than descending into it twice.
    it('lays out a graph where two paths meet again', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('gate', 'gate'), node('fix'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'gate', kind: 'pass' },
                { id: 'e2', source: 'gate', target: 'fix', kind: 'fail' },
                { id: 'e3', source: 'fix', target: 'end', kind: 'pass' },
                { id: 'e4', source: 'gate', target: 'end', kind: 'pass' },
            ],
        });
        // `end` is reached both down the trunk and through the repair branch;
        // it sits below both and appears once.
        expect(at(g, 'end').y).toBeGreaterThan(at(g, 'fix').y);
        expect(new Set(g.nodes.map((n) => `${n.position.x}:${n.position.y}`)).size).toBe(4);
    });

    // Same graph, edges stored in the opposite order: a layout that depended
    // on storage order would tidy the same workflow two different ways.
    it('lays a graph out the same way whichever order its edges are stored', () => {
        const nodes = [node('start', 'start'), node('gate', 'gate'), node('a'), node('b'), node('end', 'end')];
        const edges = [
            { id: 'e1', source: 'start', target: 'gate', kind: 'pass' as const },
            { id: 'e2', source: 'gate', target: 'end', kind: 'pass' as const },
            { id: 'f1', source: 'gate', target: 'a', kind: 'fail' as const },
            { id: 'f2', source: 'gate', target: 'b', kind: 'fail' as const },
        ];
        const forwards = tidyGraph({ nodes, edges });
        const backwards = tidyGraph({ nodes, edges: [...edges].reverse() });
        for (const n of nodes) {
            expect(at(backwards, n.id)).toEqual(at(forwards, n.id));
        }
    });

    it('leaves the edges exactly as they were', () => {
        const before = repairGraph();
        expect(tidyGraph(before).edges).toEqual(before.edges);
    });

    it('mutates nothing, so the caller can undo', () => {
        const before = repairGraph();
        tidyGraph(before);
        expect(before.nodes.every((n) => n.position.x === 0 && n.position.y === 0)).toBe(true);
    });

    it('does nothing to an empty graph', () => {
        const empty: IWorkflowGraph = { nodes: [], edges: [] };
        expect(tidyGraph(empty)).toBe(empty);
    });

    // A graph mid-edit has no Start until one is dropped in.
    it('lays out a graph with no start node', () => {
        const g = tidyGraph({
            nodes: [node('a'), node('b')],
            edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'pass' }],
        });
        expect(at(g, 'b').y - at(g, 'a').y).toBe(ROW_H);
    });

    // A dangling edge is invalid, and the canvas still has to draw it —
    // otherwise the Owner cannot see the connection in order to delete it.
    it('lays out a graph whose edge points at a node that is gone', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('a')],
            edges: [
                { id: 'e1', source: 'start', target: 'a', kind: 'pass' },
                { id: 'ghost', source: 'a', target: 'vanished', kind: 'pass' },
            ],
        });
        expect(at(g, 'a').y).toBe(ROW_H);
    });

    // A loop return whose entry node has no pass successor reserves nothing;
    // there is no trunk to push past.
    it('handles a loop back into a node with nothing after it', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('a'), node('b')],
            edges: [
                { id: 'e1', source: 'start', target: 'a', kind: 'pass' },
                { id: 'e2', source: 'a', target: 'b', kind: 'fail' },
                { id: 'e3', source: 'b', target: 'a', kind: 'pass' },
            ],
        });
        expect(new Set(g.nodes.map((n) => `${n.position.x}:${n.position.y}`)).size).toBe(3);
    });

    it('lays out a graph with no edges at all', () => {
        const g = tidyGraph({ nodes: [node('a'), node('b')], edges: [] });
        expect(new Set(g.nodes.map((n) => `${n.position.x}:${n.position.y}`)).size).toBe(2);
    });

    // A cycle among nodes Start never reaches survives back-edge removal,
    // because the walk that removes them starts from Start.
    it('lays out an unreachable cycle instead of hanging', () => {
        const g = tidyGraph({
            nodes: [node('start', 'start'), node('x'), node('y')],
            edges: [
                { id: 'e1', source: 'x', target: 'y', kind: 'pass' },
                { id: 'e2', source: 'y', target: 'x', kind: 'pass' },
            ],
        });
        expect(g.nodes).toHaveLength(3);
    }, 1000);
});
