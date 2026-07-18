import { describe, expect, it } from 'vitest';
import {
    buildQueueItems,
    formatNextRunDelta,
    getAgentStatusLabel,
    isQueuedStatus,
    isRunningStatus,
    isWaitingStatus,
    lastRunErrored,
    pickRunStatus,
    shortId,
    summarizeAgents,
    type AgentQueueSummary,
    type QueueItem,
} from './queueViewModel.js';
import {
    makeAgent,
    makeBug,
    makeEpic,
    makeStory,
    makeSubBug,
    makeSubTask,
} from '../../test-utils/factories.js';
import type { IAgentRun } from '@atlas/shared';

describe('queueViewModel status predicates', () => {
    it('isRunningStatus matches only in_progress (in_review is awaiting-review, not running)', () => {
        expect(isRunningStatus('in_progress')).toBe(true);
        expect(isRunningStatus('in_review')).toBe(false);
        expect(isRunningStatus('ready')).toBe(false);
        expect(isRunningStatus('draft')).toBe(false);
    });

    it('isQueuedStatus matches only ready', () => {
        expect(isQueuedStatus('ready')).toBe(true);
        expect(isQueuedStatus('draft')).toBe(false);
    });

    it('isWaitingStatus matches waiting_for_info and in_review', () => {
        expect(isWaitingStatus('waiting_for_info')).toBe(true);
        expect(isWaitingStatus('in_review')).toBe(true);
        expect(isWaitingStatus('ready')).toBe(false);
    });

    it('shortId returns the id unchanged', () => {
        expect(shortId('CER-12', 'EPC')).toBe('CER-12');
    });
});

describe('buildQueueItems', () => {
    it('flattens epics, stories, bugs, subtasks, subbugs into queue items', () => {
        const epic = makeEpic({ id: 'ATL-1', project_id: 'p1' });
        const story = makeStory({ id: 'ATL-2', epic_id: 'ATL-1' });
        const bug = makeBug({ id: 'ATL-5', epic_id: 'ATL-1' });
        const subTask = makeSubTask({ id: 'ATL-3', story_id: 'ATL-2' });
        const subBug = makeSubBug({ id: 'ATL-4', story_id: 'ATL-2' });

        const items = buildQueueItems({
            epics: [epic],
            stories: [story],
            bugs: [bug],
            subTasks: [subTask],
            subBugs: [subBug],
            projectIdByEpic: new Map([['ATL-1', 'p1']]),
            projectIdByStory: new Map([['ATL-2', 'p1']]),
        });

        expect(items).toHaveLength(5);
        expect(items[0]?.type).toBe('epic');
        expect(items[0]?.project_id).toBe('p1');
        expect(items[1]?.type).toBe('story');
        expect(items[1]?.project_id).toBe('p1');
        expect(items[2]?.type).toBe('bug');
        expect(items[3]?.type).toBe('sub_task');
        expect(items[3]?.project_id).toBe('p1');
        expect(items[4]?.type).toBe('sub_bug');
    });

    it('returns null project_id when lookups miss', () => {
        const story = makeStory({ id: 's1', epic_id: 'missing' });
        const items = buildQueueItems({
            epics: [],
            stories: [story],
            bugs: [],
            projectIdByEpic: new Map(),
            projectIdByStory: new Map(),
        });
        expect(items[0]?.project_id).toBeNull();
    });
});

describe('summarizeAgents', () => {
    it('partitions assigned items into running/queued and picks last run', () => {
        const agent = makeAgent({ id: 'agent-coder', status: 'active' });
        const items: QueueItem[] = [
            {
                id: 'i1',
                type: 'story',
                displayId: 'i1',
                title: 'A',
                status: 'in_progress',
                assignee_agent_id: 'agent-coder',
                project_id: 'p1',
                updated_at: '2026-05-16T10:00:00.000Z',
            },
            {
                id: 'i2',
                type: 'story',
                displayId: 'i2',
                title: 'B',
                status: 'ready',
                assignee_agent_id: 'agent-coder',
                project_id: 'p1',
                updated_at: '2026-05-15T09:00:00.000Z',
            },
            {
                id: 'i3',
                type: 'story',
                displayId: 'i3',
                title: 'C',
                status: 'ready',
                assignee_agent_id: 'agent-coder',
                project_id: 'p1',
                updated_at: '2026-05-14T09:00:00.000Z',
            },
            {
                id: 'i4',
                type: 'story',
                displayId: 'i4',
                title: 'D',
                status: 'ready',
                assignee_agent_id: 'agent-other',
                project_id: 'p1',
                updated_at: '2026-05-16T10:00:00.000Z',
            },
        ];
        const runs: IAgentRun[] = [
            {
                id: 'r1',
                agent_id: 'agent-coder',
                issue_id: 'i1',
                issue_type: 'story',
                project_id: null,
                status: 'completed',
                prompt_snapshot: null,
                output_text: null,
                started_at: '2026-05-10T00:00:00.000Z',
                completed_at: '2026-05-10T00:05:00.000Z',
                parent_run_id: null,
                setup_output_text: null,
                outcome_kind: null,
                outcome_summary: null,
                outcome_reason: null,
                outcome_checklist: null,
                input_tokens: null,
                output_tokens: null,
                cache_creation_tokens: null,
                cache_read_tokens: null,
                total_cost_usd: null,
                credits: null,
                item_title: null,
                created_at: '2026-05-10T00:00:00.000Z',
            },
        ];
        const itemsById = new Map(items.map((i) => [i.id, i]));
        const summaries = summarizeAgents({
            agents: [agent],
            items,
            runsByAgent: new Map([['agent-coder', runs]]),
            itemsById,
        });
        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.running.map((i) => i.id)).toEqual(['i1']);
        expect(summaries[0]?.queued.map((i) => i.id)).toEqual(['i3', 'i2']);
        expect(summaries[0]?.totalAssigned).toBe(3);
        expect(summaries[0]?.nextRunItem?.id).toBe('i1');
        expect(summaries[0]?.lastRun?.id).toBe('r1');
    });
});

describe('formatNextRunDelta', () => {
    it('returns "running now" for non-positive', () => {
        expect(formatNextRunDelta(0)).toBe('running now');
        expect(formatNextRunDelta(-5)).toBe('running now');
    });
    it('formats minute values', () => {
        expect(formatNextRunDelta(45)).toBe('in 45m');
    });
    it('formats hour values with remainder', () => {
        expect(formatNextRunDelta(125)).toBe('in 2h 5m');
    });
    it('formats whole hours without remainder', () => {
        expect(formatNextRunDelta(120)).toBe('in 2h');
    });
    it('formats day values', () => {
        expect(formatNextRunDelta(60 * 25)).toBe('in 1d');
    });
});

describe('getAgentStatusLabel + lastRunErrored', () => {
    function summary(over: Partial<AgentQueueSummary>): AgentQueueSummary {
        return {
            agent: makeAgent({ status: 'active' }),
            running: [],
            queued: [],
            nextRunItem: null,
            lastCompletedItem: null,
            lastCompletedAt: null,
            lastRun: null,
            totalAssigned: 0,
            ...over,
        };
    }

    it('returns Paused for inactive agents', () => {
        expect(
            getAgentStatusLabel(summary({ agent: makeAgent({ status: 'inactive' }) }), false),
        ).toBe('Paused');
    });

    it('returns Failed when errorState is set', () => {
        expect(getAgentStatusLabel(summary({}), true)).toBe('Failed');
    });

    it('returns Running when any item is in progress', () => {
        const item: QueueItem = {
            id: 'x',
            type: 'story',
            displayId: 'x',
            title: 't',
            status: 'in_progress',
            assignee_agent_id: 'a',
            project_id: null,
            updated_at: '',
        };
        expect(getAgentStatusLabel(summary({ running: [item] }), false)).toBe('Running');
    });

    it('returns Idle otherwise', () => {
        expect(getAgentStatusLabel(summary({}), false)).toBe('Idle');
    });

    it('lastRunErrored is true only for error runs', () => {
        expect(lastRunErrored(null)).toBe(false);
        const ok = { status: 'completed' } as IAgentRun;
        const bad = { status: 'error' } as IAgentRun;
        expect(lastRunErrored(ok)).toBe(false);
        expect(lastRunErrored(bad)).toBe(true);
    });
});

describe('summarizeAgents — error runs + null completed_at branches', () => {
    it('includes error-status runs in completed list and uses created_at when completed_at is null', () => {
        const agent = makeAgent({ id: 'a1', status: 'active' });
        const item: QueueItem = {
            id: 'i1',
            type: 'story',
            displayId: 'i1',
            title: 'T',
            status: 'in_progress',
            assignee_agent_id: 'a1',
            project_id: 'p1',
            updated_at: '2026-01-01T00:00:00.000Z',
        };
        // An error run without completed_at — exercises line 143 (error branch)
        // and line 149 (created_at fallback) and line 145 sort fallback
        const errorRun: IAgentRun = {
            id: 'r_err',
            agent_id: 'a1',
            issue_id: 'i1',
            issue_type: 'story',
            project_id: null,
            status: 'error',
            prompt_snapshot: null,
            output_text: null,
            started_at: '2026-01-02T00:00:00.000Z',
            completed_at: null,
            parent_run_id: null,
            setup_output_text: null,
            outcome_kind: null,
            outcome_summary: null,
            outcome_reason: null,
            outcome_checklist: null,
            input_tokens: null,
            output_tokens: null,
            cache_creation_tokens: null,
            cache_read_tokens: null,
            total_cost_usd: null,
            credits: null,
            item_title: null,
            created_at: '2026-01-02T00:00:00.000Z',
        };
        const summaries = summarizeAgents({
            agents: [agent],
            items: [item],
            runsByAgent: new Map([['a1', [errorRun]]]),
            itemsById: new Map([['i1', item]]),
        });
        expect(summaries[0]?.lastRun?.id).toBe('r_err');
        // lastCompletedAt falls back to created_at since completed_at is null
        expect(summaries[0]?.lastCompletedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('picks most recent when two completed runs have differing completed_at', () => {
        const agent = makeAgent({ id: 'a2', status: 'active' });
        const item: QueueItem = {
            id: 'i1',
            type: 'story',
            displayId: 'i1',
            title: 'T',
            status: 'in_progress',
            assignee_agent_id: 'a2',
            project_id: null,
            updated_at: '2026-01-01T00:00:00.000Z',
        };
        const run1: IAgentRun = {
            id: 'r1',
            agent_id: 'a2',
            issue_id: 'i1',
            issue_type: 'story',
            project_id: null,
            status: 'completed',
            prompt_snapshot: null,
            output_text: null,
            started_at: '2026-01-01T00:00:00.000Z',
            completed_at: '2026-01-01T00:05:00.000Z',
            parent_run_id: null,
            setup_output_text: null,
            outcome_kind: null,
            outcome_summary: null,
            outcome_reason: null,
            outcome_checklist: null,
            input_tokens: null,
            output_tokens: null,
            cache_creation_tokens: null,
            cache_read_tokens: null,
            total_cost_usd: null,
            credits: null,
            item_title: null,
            created_at: '2026-01-01T00:00:00.000Z',
        };
        const run2: IAgentRun = {
            ...run1,
            id: 'r2',
            completed_at: '2026-01-02T00:05:00.000Z',
            created_at: '2026-01-02T00:00:00.000Z',
        };
        const summaries = summarizeAgents({
            agents: [agent],
            items: [item],
            runsByAgent: new Map([['a2', [run1, run2]]]),
            itemsById: new Map([['i1', item]]),
        });
        // run2 is more recent
        expect(summaries[0]?.lastRun?.id).toBe('r2');
    });

    it('returns null lastRun when agent has no runs', () => {
        const agent = makeAgent({ id: 'a3', status: 'active' });
        const summaries = summarizeAgents({
            agents: [agent],
            items: [],
            runsByAgent: new Map(),
            itemsById: new Map(),
        });
        expect(summaries[0]?.lastRun).toBeNull();
        expect(summaries[0]?.lastCompletedAt).toBeNull();
        expect(summaries[0]?.nextRunItem).toBeNull();
    });
});

describe('pickRunStatus', () => {
    it('returns null for missing or empty', () => {
        expect(pickRunStatus(undefined)).toBeNull();
        expect(pickRunStatus([])).toBeNull();
    });
    it('prefers in_progress over queued', () => {
        const runs = [
            { status: 'queued' } as IAgentRun,
            { status: 'in_progress' } as IAgentRun,
        ];
        expect(pickRunStatus(runs)).toBe('in_progress');
    });
    it('falls back to queued when no in_progress', () => {
        expect(pickRunStatus([{ status: 'queued' } as IAgentRun])).toBe('queued');
    });
    it('returns null for terminal-only runs', () => {
        expect(pickRunStatus([{ status: 'completed' } as IAgentRun])).toBeNull();
    });
});
