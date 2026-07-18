import { describe, expect, it } from 'vitest';
import { isSimulatedRun } from './isSimulatedRun.js';
import type { IAgentRun } from '@atlas/shared';

const baseRun: Partial<IAgentRun> = {
    id: 'R1',
    agent_id: 'agent-coder',
    issue_type: 'epic',
    issue_id: 'X',
    prompt_snapshot: null,
    started_at: null,
    completed_at: null,
    created_at: '',
};

describe('isSimulatedRun', () => {
    it('returns true when output_text starts with the [SIMULATED marker', () => {
        const run = { ...baseRun, status: 'completed', output_text: '[SIMULATED — set ATLAS_AI_ENABLED=true to use real CLI]\n\nPrompt length: 6000 chars' } as IAgentRun;
        expect(isSimulatedRun(run, true)).toBe(true);
        expect(isSimulatedRun(run, false)).toBe(true);
    });

    it('returns false when a completed run has real output (no marker)', () => {
        const run = { ...baseRun, status: 'completed', output_text: 'TOOL Edit ...real-cli-output...' } as IAgentRun;
        expect(isSimulatedRun(run, true)).toBe(false);
        expect(isSimulatedRun(run, false)).toBe(false);
    });

    it('falls back to the global flag for queued runs with null output', () => {
        const run = { ...baseRun, status: 'queued', output_text: null } as IAgentRun;
        expect(isSimulatedRun(run, false)).toBe(true);
        expect(isSimulatedRun(run, true)).toBe(false);
    });

    it('falls back to the global flag for in_progress runs with empty output', () => {
        const run = { ...baseRun, status: 'in_progress', output_text: '' } as IAgentRun;
        expect(isSimulatedRun(run, false)).toBe(true);
        expect(isSimulatedRun(run, true)).toBe(false);
    });

    it('returns false when run is null', () => {
        expect(isSimulatedRun(null, false)).toBe(false);
        expect(isSimulatedRun(null, true)).toBe(false);
    });

    it('returns false when run is undefined', () => {
        expect(isSimulatedRun(undefined, false)).toBe(false);
    });

    it('returns false when aiEnabled is undefined (settings still loading)', () => {
        // Queued run with no output + unknown ai flag: caller hasn't learned
        // yet whether AI is on, so we must NOT flash the simulator badge.
        const queued = { ...baseRun, status: 'queued', output_text: null } as IAgentRun;
        expect(isSimulatedRun(queued, undefined)).toBe(false);

        // The marker still wins even when ai_enabled is unknown.
        const marked = {
            ...baseRun,
            status: 'completed',
            output_text: '[SIMULATED — set ATLAS_AI_ENABLED=true to use real CLI]',
        } as IAgentRun;
        expect(isSimulatedRun(marked, undefined)).toBe(true);
    });
});
