import { describe, expect, it } from 'vitest';
import type { IWorkflowGraph } from '@atlas/shared';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { pipelineView } from './pipeline.js';

const agents = new Map([['agent-coder', { name: 'Coder' }]]);
const p = { x: 0, y: 0 };

// Start → Coder → Lint ─pass→ Release → End, with Lint ─fail→ Fixer → Fix review → Lint.
const withDetour: IWorkflowGraph = {
    nodes: [
        { id: 'start', type: 'start', position: p },
        { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: p },
        { id: 'check-lint', type: 'script', label: 'Lint', position: p },
        { id: 'fix', type: 'agent', agent_id: 'agent-hygiene-fixer', position: p },
        { id: 'fix-review', type: 'agent', agent_id: 'agent-fix-reviewer', position: p },
        { id: 'ask', type: 'owner', position: p },
        { id: 'end', type: 'end', position: p },
    ],
    edges: [
        { id: '1', source: 'start', target: 'coder', kind: 'pass' },
        { id: '2', source: 'coder', target: 'check-lint', kind: 'pass' },
        { id: '3', source: 'check-lint', target: 'ask', kind: 'pass' },
        { id: '4', source: 'check-lint', target: 'fix', kind: 'fail' },
        { id: '5', source: 'fix', target: 'fix-review', kind: 'pass' },
        { id: '6', source: 'fix-review', target: 'check-lint', kind: 'pass' },
        { id: '7', source: 'fix-review', target: 'fix', kind: 'fail' },
        { id: '8', source: 'ask', target: 'end', kind: 'pass' },
    ],
};

describe('pipelineView', () => {
    it('lays the pass path out as stations, without Start and End', () => {
        const v = pipelineView(makeWorkflow().graph, 'review', agents);
        expect(v.stations.map((s) => s.label)).toEqual(['Coder', 'Reviewer']);
        expect(v).toMatchObject({ at: 1, detour: null });
    });

    it('names steps by agent, script label, and owner', () => {
        const v = pipelineView(withDetour, null, agents);
        expect(v.stations.map((s) => s.label)).toEqual(['Coder', 'Lint', 'You']);
        expect(v.at).toBe(-1);
    });

    it('places a run on a fix-up detour at the station it branched from', () => {
        expect(pipelineView(withDetour, 'fix-review', agents)).toMatchObject({
            at: 1,
            detour: 'Fix Reviewer',
        });
    });

    it('stops on a pass cycle instead of looping forever', () => {
        const cyclic: IWorkflowGraph = {
            nodes: [
                { id: 'start', type: 'start', position: p },
                { id: 'a', type: 'script', label: 'A', position: p },
                { id: 'b', type: 'script', label: 'B', position: p },
            ],
            edges: [
                { id: '1', source: 'start', target: 'a', kind: 'pass' },
                { id: '2', source: 'a', target: 'b', kind: 'pass' },
                { id: '3', source: 'b', target: 'a', kind: 'pass' },
            ],
        };
        expect(pipelineView(cyclic, 'zzz', agents)).toMatchObject({ at: -1, detour: null });
        expect(pipelineView(cyclic, 'b', agents).stations).toHaveLength(2);
    });
});
