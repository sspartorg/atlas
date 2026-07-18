import { describe, expect, it } from 'vitest';
import { assemblePreamble } from './preamble-assembler.js';

describe('assemblePreamble', () => {
    it('renders the 4 .atlas/* file references with the agent id', () => {
        const out = assemblePreamble('agent-architect');
        expect(out).toContain('You are agent `agent-architect`.');
        expect(out).toContain('.atlas/constitution.md');
        expect(out).toContain('.atlas/handoff.md');
        expect(out).toContain('.atlas/current-task.md');
        expect(out).toContain('.atlas/self-memory.md');
    });

    it('substitutes the agent id on every call (no shared state)', () => {
        expect(assemblePreamble('alpha')).toContain('`alpha`');
        expect(assemblePreamble('beta')).toContain('`beta`');
    });
});
