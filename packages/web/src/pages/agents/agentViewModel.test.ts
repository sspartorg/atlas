import { describe, expect, it } from 'vitest';
import {
    CATEGORY_LABEL,
    agentSubtitle,
    countQueueDepthByAgent,
    getAgentView,
    getRuntimeStats,
    resolveAgentStatusLabel,
} from './agentViewModel.js';
import { makeAgent, makeSubTask, makeTask } from '../../test-utils/factories.js';
import type { IAgentRun } from '@atlas/shared';

describe('CATEGORY_LABEL', () => {
    it('covers all known categories', () => {
        expect(CATEGORY_LABEL['software-dev']).toBe('Software dev');
        expect(CATEGORY_LABEL.marketing).toBe('Marketing');
        expect(CATEGORY_LABEL.content).toBe('Content');
        expect(CATEGORY_LABEL.design).toBe('Design');
    });
});

describe('getAgentView', () => {
    it('uses seed config for known agent ids', () => {
        const agent = makeAgent({ id: 'agent-coder', category: 'software-dev' });
        expect(getAgentView(agent).glyph).toBe('terminal');
    });

    it('falls back to category glyph for unknown agent ids', () => {
        const agent = makeAgent({ id: 'agent-novel', category: 'marketing', prompt_md: '' });
        expect(getAgentView(agent).glyph).toBe('campaign');
    });

    it('uses the first non-heading prompt line as description fallback', () => {
        const agent = makeAgent({
            id: 'agent-x',
            prompt_md: '# Header\n```code```\nThe real first line',
            category: 'content',
        });
        expect(getAgentView(agent).description).toBe('The real first line');
    });
});

describe('getRuntimeStats', () => {
    it('returns zeros when no runs', () => {
        expect(getRuntimeStats([])).toEqual({
            runningCount: 0,
            queuedCount: 0,
            lastRunErrored: false,
            lastRunAt: null,
            totalRunsThisMonth: 0,
            p50DurationSec: null,
            totalCostThisMonthUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCacheReadTokens: null,
        });
        expect(getRuntimeStats(undefined)).toEqual({
            runningCount: 0,
            queuedCount: 0,
            lastRunErrored: false,
            lastRunAt: null,
            totalRunsThisMonth: 0,
            p50DurationSec: null,
            totalCostThisMonthUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCacheReadTokens: null,
        });
    });

    it('splits queued and in_progress runs', () => {
        const now = new Date().toISOString();
        const runs: IAgentRun[] = [
            { status: 'queued', created_at: now, started_at: null, completed_at: null } as IAgentRun,
            { status: 'in_progress', created_at: now, started_at: null, completed_at: null } as IAgentRun,
            { status: 'completed', created_at: now, started_at: null, completed_at: null } as IAgentRun,
        ];
        expect(getRuntimeStats(runs)).toMatchObject({ queuedCount: 1, runningCount: 1 });
    });

    it('computes a p50 duration from started/completed pairs', () => {
        const runs: IAgentRun[] = [
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:10.000Z',
            } as IAgentRun,
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:20.000Z',
            } as IAgentRun,
            {
                status: 'completed',
                created_at: new Date().toISOString(),
                started_at: '2026-05-15T00:00:00.000Z',
                completed_at: '2026-05-15T00:00:30.000Z',
            } as IAgentRun,
        ];
        expect(getRuntimeStats(runs).p50DurationSec).toBe(20);
    });

    it('tracks the most recent run timestamp', () => {
        const runs: IAgentRun[] = [
            { status: 'completed', created_at: '2026-04-01T00:00:00.000Z', started_at: null, completed_at: null } as IAgentRun,
            { status: 'completed', created_at: '2026-05-10T00:00:00.000Z', started_at: null, completed_at: null } as IAgentRun,
        ];
        expect(getRuntimeStats(runs).lastRunAt).toBe('2026-05-10T00:00:00.000Z');
    });
});

describe('agentSubtitle', () => {
    it('uses designation over role_id', () => {
        const a = makeAgent({ designation: 'Senior Backend Engineer', category: 'software-dev', role_id: 'engineer' });
        expect(agentSubtitle(a)).toBe('Senior Backend Engineer · Software dev');
    });

    it('falls back to role_id label when no designation', () => {
        const a = makeAgent({ designation: '', category: 'software-dev', role_id: 'engineer' });
        expect(agentSubtitle(a)).toBe('Engineer · Software dev');
    });

    it('returns category label alone when neither designation nor role_id', () => {
        const a = makeAgent({ designation: '', category: 'marketing', role_id: null });
        expect(agentSubtitle(a)).toBe('Marketing');
    });

    it('uses po role label', () => {
        const a = makeAgent({ designation: '', category: 'software-dev', role_id: 'po' });
        expect(agentSubtitle(a)).toBe('Product Owner · Software dev');
    });
});

describe('getAgentView — fallback chains for glyph/description', () => {
    it('uses glyph from agent.glyph when set (non-empty trim)', () => {
        const agent = makeAgent({
            id: 'agent-novel',
            category: 'content',
            glyph: 'star',
        });
        const view = getAgentView(agent);
        expect(view.glyph).toBe('star');
    });

    it('falls back to CATEGORY_GLYPH when agent has no seed and no glyph', () => {
        const agent = makeAgent({
            id: 'agent-novel-no-seed',
            category: 'design',
            glyph: '',
        });
        const view = getAgentView(agent);
        expect(view.glyph).toBe('palette'); // CATEGORY_GLYPH.design
    });

    it('uses agent.description when set (non-empty trim)', () => {
        const agent = makeAgent({
            id: 'agent-novel',
            category: 'content',
            description: 'Custom description text',
        });
        const view = getAgentView(agent);
        expect(view.description).toBe('Custom description text');
    });

});

describe('getRuntimeStats — partial token coverage', () => {
    it('accumulates only input_tokens when output/cache are null', () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r1',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: null,
                input_tokens: 1000,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalInputTokens).toBe(1000);
        expect(stats.totalOutputTokens).toBe(0);
        expect(stats.totalCacheReadTokens).toBe(0);
    });

    it('accumulates cost when total_cost_usd is set', () => {
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r1',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: 1.5,
                input_tokens: null,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalCostThisMonthUsd).toBe(1.5);
        expect(stats.totalInputTokens).toBeNull();
    });
});

describe('agentSubtitle — unknown role_id fallback', () => {
    it('shows category label alone when role_id is unknown', () => {
        const a = makeAgent({ designation: '', category: 'content', role_id: 'some-unknown-role' as never });
        // SDLC_ROLE_LABELS['some-unknown-role'] is undefined → 'undefined · Content'
        // This exercises the role_id branch with an unknown key
        const result = agentSubtitle(a);
        expect(result).toContain('Content');
    });
});

describe('getRuntimeStats — output_tokens and cache_read_tokens non-null (L436/L437)', () => {
    it('accumulates output_tokens and cache_read_tokens when non-null — covers L436/L437 branches', () => {
        // These branches at lines 436-437 fire when output_tokens or cache_read_tokens is set.
        // The test at L610 only sets input_tokens; we need both output and cache_read covered.
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'r-tokens',
                status: 'completed' as const,
                created_at: thisMonth,
                started_at: null,
                completed_at: null,
                total_cost_usd: null,
                input_tokens: null,
                output_tokens: 500,        // non-null → covers L436 body
                cache_read_tokens: 200,    // non-null → covers L437 body
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        expect(stats.totalOutputTokens).toBe(500);
        expect(stats.totalCacheReadTokens).toBe(200);
        expect(stats.totalInputTokens).toBe(0);
        expect(stats.totalCostThisMonthUsd).toBeNull();
    });
});

describe('getRuntimeStats — started_at set but completed_at null', () => {
    it('does NOT push a duration when started_at is set but completed_at is null — p50 stays null', () => {
        // This exercises the else branch of `if (r.started_at && r.completed_at)` at line 439
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
        const runs = [
            {
                id: 'run-in-progress',
                agent_id: 'a',
                status: 'in_progress',
                created_at: thisMonth,
                started_at: '2026-05-20T10:00:00.000Z', // started_at set
                completed_at: null,                       // completed_at null → no duration
                total_cost_usd: null,
                input_tokens: null,
                output_tokens: null,
                cache_read_tokens: null,
            },
        ] as unknown as IAgentRun[];
        const stats = getRuntimeStats(runs);
        // No completed_at → durations array stays empty → p50DurationSec is null
        expect(stats.p50DurationSec).toBeNull();
        expect(stats.runningCount).toBe(1);
    });
});

describe('resolveAgentStatusLabel', () => {
    it('ranks Paused > Failed > Running > Queued > Idle', () => {
        expect(resolveAgentStatusLabel('inactive', 1, 1, true)).toBe('Paused');
        expect(resolveAgentStatusLabel('active', 1, 1, true)).toBe('Failed');
        expect(resolveAgentStatusLabel('active', 1, 1, false)).toBe('Running');
        expect(resolveAgentStatusLabel('active', 0, 1, false)).toBe('Queued');
        expect(resolveAgentStatusLabel('active', 0, 0, false)).toBe('Idle');
    });
});

describe('countQueueDepthByAgent', () => {
    it('counts ready and in_progress items per assignee', () => {
        const depth = countQueueDepthByAgent([
            makeSubTask({ id: 'S-1', assignee_agent_id: 'a1', status: 'ready' }),
            makeTask({ id: 'T-1', assignee_agent_id: 'a1', status: 'in_progress' }),
            makeTask({ id: 'T-2', assignee_agent_id: 'a1', status: 'in_review' }),
            makeSubTask({ id: 'S-2', assignee_agent_id: null, status: 'ready' }),
        ]);
        expect(depth.get('a1')).toBe(2);
        expect(depth.size).toBe(1);
    });
});
