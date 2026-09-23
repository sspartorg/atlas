import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IIssueTreeNode, IIssueTreeResponse, IWorkflowGraph, IWorkflowTemplate } from '@atlas/shared';
import { makeTask } from '../../test-utils/factories.js';
import { makeTemplates } from '../../test-utils/workflowFixtures.js';
import {
    agentLabel,
    deliveryLabel,
    durationLabel,
    graphAgentIds,
    itemPathIn,
    subTemplates,
    gateTitle,
    subtasksLabel,
    templateAgentIds,
    triggerLabel,
} from './labels.js';

type Delivery = NonNullable<Parameters<typeof deliveryLabel>[0]>;

function delivery(overrides: Partial<Delivery> = {}): Delivery {
    return { input_kind: 'item', push_code: false, raises_pr: false, ...overrides };
}

describe('deliveryLabel', () => {
    it('says nothing when there is no workflow to describe', () => {
        expect(deliveryLabel(null)).toBe('');
    });

    // A sub-task workflow hands its work back to the parent Task run, so it
    // must never advertise a push or a PR even when those flags are set —
    // the parent's delivery is the one that happens.
    it('reports a sub-task workflow as handing back, whatever its push flags say', () => {
        expect(deliveryLabel(delivery({ input_kind: 'sub_task', push_code: true, raises_pr: true }))).toBe(
            'Back to the Task',
        );
    });

    // Pushing straight to the default branch means no PR is opened, so
    // "Push + PR" here would tell the Owner a review step exists that doesn't.
    it('prefers the default-branch push over the PR label when both are set', () => {
        expect(deliveryLabel(delivery({ push_code: true, raises_pr: true, push_to_default: true }))).toBe(
            'Push to default branch',
        );
    });

    it('names each remaining push/PR combination', () => {
        expect(deliveryLabel(delivery({ push_code: true, raises_pr: true }))).toBe('Push + PR');
        expect(deliveryLabel(delivery({ push_code: true }))).toBe('Push branch');
        // G-016 — raises_pr alone delivers NOTHING: deliver() requires
        // push_code too. This asserted 'Pull request', a promise the engine
        // does not keep.
        expect(deliveryLabel(delivery({ raises_pr: true }))).toBe('No delivery');
        expect(deliveryLabel(delivery())).toBe('No delivery');
    });

    // push_to_default is optional on the input type; without push_code it is
    // irrelevant and must not shadow the PR-only answer.
    it('ignores push_to_default when nothing is pushed', () => {
        expect(deliveryLabel(delivery({ raises_pr: true, push_to_default: true }))).toBe(
            'No delivery',
        );
    });
});

describe('triggerLabel', () => {
    it('leaves a non-schedule trigger as its plain label', () => {
        expect(
            triggerLabel({ trigger: 'manual', schedule_preset: null, next_run_at: null })
        ).toBe('Manual');
        expect(
            triggerLabel({ trigger: 'item_ready', schedule_preset: null, next_run_at: null })
        ).toBe('On item ready');
    });

    // A bare "Scheduled" was the whole complaint: the cadence only existed on
    // the Start node inside the canvas, so the list and header couldn't say
    // whether a workflow ran hourly or weekly.
    it('spells out the cadence and the next fire', () => {
        const label = triggerLabel({
            trigger: 'schedule',
            schedule_preset: 'hourly',
            next_run_at: '2026-09-22T14:00:00.000Z',
        });
        expect(label).toContain('Scheduled');
        expect(label).toContain('every hour');
        expect(label).toContain('next ');
    });

    it('still names the cadence before the first fire is computed', () => {
        expect(
            triggerLabel({ trigger: 'schedule', schedule_preset: 'weekly', next_run_at: null })
        ).toBe('Scheduled · weekly');
    });
});

describe('agentLabel', () => {
    it('uses the installed agent’s own name', () => {
        expect(agentLabel('agent-coder', new Map([['agent-coder', { name: 'My Coder' }]]))).toBe('My Coder');
    });

    // A catalog id appears on the canvas before the agent is installed; it has
    // to read as a name rather than as a slug.
    it('title-cases a catalog id that is not installed yet', () => {
        expect(agentLabel('agent-code-reviewer', new Map())).toBe('Code Reviewer');
    });

    it('title-cases an id that carries no agent- prefix', () => {
        expect(agentLabel('release-captain', new Map())).toBe('Release Captain');
    });

    it('keeps catalog acronyms uppercase when the agent is not installed', () => {
        expect(agentLabel('agent-po-writer', new Map())).toBe('PO Writer');
        expect(agentLabel('agent-qa-reviewer', new Map())).toBe('QA Reviewer');
        expect(agentLabel('agent-ai-readiness', new Map())).toBe('AI Readiness');
    });
});

describe('gateTitle', () => {
    it('prettifies a gate script id', () => {
        expect(gateTitle('gate-coverage')).toBe('Coverage');
        expect(gateTitle('gate-hygiene')).toBe('Hygiene');
    });

    it('keeps an id that does not carry the gate- prefix', () => {
        expect(gateTitle('coder-tests-green')).toBe('Coder tests green');
    });

    it('prompts when the gate has no script yet', () => {
        expect(gateTitle(undefined)).toBe('Choose a script');
    });
});

describe('subtasksLabel', () => {
    it('names the label a Sub-tasks step filters on', () => {
        expect(subtasksLabel('qa')).toBe('Labelled “qa”');
    });

    // Clearing the label field leaves '' behind, not undefined — rendering
    // `Labelled “”` would be worse than saying the step is the catch-all.
    it('falls back to the catch-all for a missing or emptied label', () => {
        expect(subtasksLabel(undefined)).toBe('All other sub-tasks');
        expect(subtasksLabel('')).toBe('All other sub-tasks');
    });
});

describe('graphAgentIds', () => {
    it('collects agent ids from agent nodes only', () => {
        const graph: IWorkflowGraph = {
            nodes: [
                { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                { id: 'a', type: 'agent', agent_id: 'agent-coder', position: { x: 0, y: 1 } },
                // An agent node the Owner hasn't picked an agent for yet.
                { id: 'b', type: 'agent', position: { x: 0, y: 2 } },
                // Invalid, but graphs are user data: a non-agent node carrying
                // an agent_id must not contribute an install.
                { id: 'c', type: 'owner', agent_id: 'agent-ghost', position: { x: 0, y: 3 } },
            ],
            edges: [],
        };
        expect(graphAgentIds(graph)).toEqual(['agent-coder']);
    });
});

describe('template composition', () => {
    it('finds the templates a template’s Sub-tasks steps run', () => {
        const all = makeTemplates();
        const [build, deliveryTemplate] = all as [IWorkflowTemplate, IWorkflowTemplate];
        expect(subTemplates(deliveryTemplate, all).map((t) => t.id)).toEqual(['build']);
        // A leaf template runs nothing further; the lookup must not match itself.
        expect(subTemplates(build, all)).toEqual([]);
    });

    it('rolls every agent the template and its sub-workflows need into one list', () => {
        const all = makeTemplates();
        const deliveryTemplate = all[1] as IWorkflowTemplate;
        expect(templateAgentIds(deliveryTemplate, all).sort()).toEqual(['agent-coder', 'agent-po-writer']);
    });

    // The install list drives "these agents will be added"; counting a shared
    // agent twice would overstate what installing the template costs.
    it('lists an agent shared by parent and sub-workflow only once', () => {
        const all = makeTemplates();
        const build = all[0] as IWorkflowTemplate;
        const deliveryTemplate = all[1] as IWorkflowTemplate;
        const shared: IWorkflowTemplate = {
            ...deliveryTemplate,
            graph: {
                ...deliveryTemplate.graph,
                nodes: [
                    ...deliveryTemplate.graph.nodes,
                    { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 0, y: 500 } },
                ],
            },
        };
        expect(templateAgentIds(shared, [build, shared])).toEqual(['agent-po-writer', 'agent-coder']);
    });
});

describe('durationLabel', () => {
    afterEach(() => vi.useRealTimers());

    it('shows a dash for a run that never started', () => {
        expect(durationLabel(null, '2026-09-14T10:05:00.000Z')).toBe('—');
    });

    it('zero-pads the seconds under an hour', () => {
        expect(durationLabel('2026-09-14T10:00:00.000Z', '2026-09-14T10:05:07.000Z')).toBe('5m 07s');
    });

    // Past an hour the seconds are dropped — a long run reads "1h 5m", never
    // "65m 00s".
    it('switches to hours and minutes past the hour', () => {
        expect(durationLabel('2026-09-14T10:00:00.000Z', '2026-09-14T11:05:30.000Z')).toBe('1h 5m');
    });

    // Clock skew between the machine that stamped started_at and the one
    // reading it must not render a negative duration.
    it('clamps a finish stamped before the start to zero', () => {
        expect(durationLabel('2026-09-14T10:05:00.000Z', '2026-09-14T10:00:00.000Z')).toBe('0m 00s');
    });

    it('measures an unfinished run against now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-14T10:02:03.000Z'));
        expect(durationLabel('2026-09-14T10:00:00.000Z', null)).toBe('2m 03s');
    });
});

describe('itemPathIn', () => {
    function makeTree(): IIssueTreeResponse {
        const base = {
            short_id: 'ATL-1',
            title: 'Add login',
            status: 'ready' as const,
            assignee_agent_id: null,
            reporter_agent_id: null,
            created_at: '2026-09-14T10:00:00.000Z',
            updated_at: '2026-09-14T10:00:00.000Z',
            project_id: 'p1',
            project_name: 'Atlas',
        };
        const sub: IIssueTreeNode = { ...base, id: 'ATL-3', kind: 'sub_task', task_id: 'ATL-1', task_title: 'Add login', children: [] };
        const task: IIssueTreeNode = { ...base, id: 'ATL-1', kind: 'task', task_id: null, task_title: null, children: [sub] };
        return { projects: [], agents: [], tree: [task], tasks: [makeTask({ id: 'ATL-1' })] };
    }

    // The panel renders before the tree query resolves; it must link nowhere
    // rather than guess a path.
    it('has no path while the tree is still loading', () => {
        expect(itemPathIn(undefined, 'ATL-1')).toBeNull();
    });

    it('routes a Task to the task page', () => {
        expect(itemPathIn(makeTree(), 'ATL-1')).toBe('/tasks/ATL-1');
    });

    // Sub-tasks are nested one level down; a run started by a Sub-tasks step
    // points at a child, and the flatten step is what finds it.
    it('routes a nested sub-task to the sub-task page', () => {
        expect(itemPathIn(makeTree(), 'ATL-3')).toBe('/sub-tasks/ATL-3');
    });

    it('has no path for an item the tree does not contain', () => {
        expect(itemPathIn(makeTree(), 'ATL-99')).toBeNull();
    });
});
