import { describe, expect, it } from 'vitest';
import { upgradeLegacyWorkflow } from './workflow-bundle.js';

// A bundle exported before Script steps (ADR 0028) carries Check (`gate`) nodes
// that name a checker agent. They must import as empty Script steps, not fail.

describe('upgradeLegacyWorkflow', () => {
    it('turns each gate into an empty script step and drops its checker', () => {
        const out = upgradeLegacyWorkflow({
            name: 'Old',
            graph: {
                nodes: [
                    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                    { id: 'cov', type: 'gate', agent_id: 'agent-tests-check', script_id: 'gate-x', position: { x: 0, y: 1 } },
                ],
                edges: [{ id: 'e', source: 'start', target: 'cov', kind: 'pass' }],
            },
        }) as { graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] } };
        expect(out.graph.nodes[1]).toEqual({ id: 'cov', type: 'script', command: '', position: { x: 0, y: 1 } });
        expect(out.graph.edges).toHaveLength(1);
    });

    it('leaves a bundle with no gate, and anything that is not a graph, untouched', () => {
        const current = { name: 'New', graph: { nodes: [{ id: 'a', type: 'script', command: 'npm test' }], edges: [] } };
        expect(upgradeLegacyWorkflow(current)).toBe(current);
        expect(upgradeLegacyWorkflow(null)).toBeNull();
        expect(upgradeLegacyWorkflow({ name: 'no graph' })).toEqual({ name: 'no graph' });
    });
});
