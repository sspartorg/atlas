import type { IPublishedWorkflowDetail, IWorkflow, IWorkflowRunDetail, IWorkflowRunStep, IWorkflowTemplate } from '@atlas/shared';

const ISO = '2026-09-14T10:00:00.000Z';

// A valid Start → Coder ⇄ Reviewer → End graph, laid out top to bottom.
export function makeWorkflow(overrides: Partial<IWorkflow> = {}): IWorkflow {
    return {
        id: 'wf-1',
        project_id: 'p1',
        name: 'Development',
        description: 'Code then review',
        status: 'active',
        graph: {
            nodes: [
                { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 0, y: 130 } },
                { id: 'review', type: 'agent', agent_id: 'agent-reviewer', position: { x: 0, y: 260 } },
                { id: 'end', type: 'end', position: { x: 0, y: 390 } },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
                { id: 'e2', source: 'coder', target: 'review', kind: 'pass' },
                { id: 'e3', source: 'review', target: 'end', kind: 'pass' },
                { id: 'e4', source: 'review', target: 'coder', kind: 'fail' },
            ],
        },
        input_kind: 'item',
        trigger: 'item_ready',
        use_worktree: true,
        push_code: true,
        raises_pr: true,
        push_to_default: false,
        max_loops: 3,
        max_parallel_runs: 1,
        schedule_preset: null,
        schedule_time_of_day: null,
        schedule_weekday: null,
        cron_expr: null,
        next_run_at: null,
        last_run_at: null,
        created_at: ISO,
        updated_at: ISO,
        ...overrides,
    };
}

export function makeRunStep(overrides: Partial<IWorkflowRunStep> = {}): IWorkflowRunStep {
    return {
        id: 'run-a',
        node_id: 'coder',
        agent_id: 'agent-coder',
        agent_name: 'Coder',
        status: 'completed',
        cli: 'claude',
        model: 'claude-opus-4-7',
        effort: 'medium',
        outcome_kind: 'done',
        outcome_summary: 'Implemented the change',
        outcome_reason: null,
        total_cost_usd: 0.42,
        started_at: ISO,
        completed_at: '2026-09-14T10:05:00.000Z',
        ...overrides,
    };
}

export function makeRunDetail(overrides: Partial<IWorkflowRunDetail> = {}): IWorkflowRunDetail {
    const wf = makeWorkflow();
    return {
        id: 'wfr-1',
        workflow_id: wf.id,
        item_id: 'ATL-7',
        project_id: 'p1',
        status: 'running',
        graph_snapshot: wf.graph,
        parent_workflow_run_id: null,
        parent_node_id: null,
        current_node_id: 'review',
        parked_node_id: null,
        park_reason: null,
        loop_count: 0,
        branch: 'atlas/wf/ATL-7',
        worktree_path: null,
        setup_done: true,
        pr_url: null,
        pr_urls: [],
        started_at: ISO,
        updated_at: ISO,
        finished_at: null,
        item_title: 'Add login',
        workflow_name: wf.name,
        children: [],
        total_cost_usd: 0.42,
        steps: [makeRunStep()],
        ...overrides,
    };
}

/** jsdom lacks the layout APIs ReactFlow measures with. */
export function stubReactFlowDom(): void {
    class DOMMatrixReadOnlyStub {
        m22: number;
        constructor(transform?: string) {
            const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
            this.m22 = scale !== undefined ? Number(scale) : 1;
        }
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: DOMMatrixReadOnlyStub });
    Object.defineProperties(HTMLElement.prototype, {
        offsetHeight: { configurable: true, get: () => 64 },
        offsetWidth: { configurable: true, get: () => 216 },
    });
    (SVGElement.prototype as unknown as { getBBox: () => object }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
}

/** Delivery (PO Writer, then a Sub-tasks step running `template:build`) and Build (Coder). */
export function makeTemplates(): IWorkflowTemplate[] {
    const p = { x: 0, y: 0 };
    return [
        {
            id: 'build',
            name: 'Build sub-task',
            description: 'Coder builds one sub-task.',
            input_kind: 'sub_task',
            trigger: 'manual',
            use_worktree: true,
            push_code: false,
            raises_pr: false,
            graph: {
                nodes: [
                    { id: 'start', type: 'start', position: p },
                    { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 0, y: 130 } },
                    { id: 'end', type: 'end', position: { x: 0, y: 260 } },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'coder', kind: 'pass' },
                    { id: 'e2', source: 'coder', target: 'end', kind: 'pass' },
                ],
            },
        },
        {
            id: 'delivery',
            name: 'Delivery',
            description: 'Plans a Task, then builds its sub-tasks.',
            input_kind: 'item',
            trigger: 'item_ready',
            use_worktree: true,
            push_code: true,
            raises_pr: true,
            graph: {
                nodes: [
                    { id: 'start', type: 'start', position: p },
                    { id: 'po', type: 'agent', agent_id: 'agent-po-writer', position: { x: 0, y: 130 } },
                    { id: 'build', type: 'subtasks', sub_workflow_id: 'template:build', position: { x: 0, y: 260 } },
                    { id: 'end', type: 'end', position: { x: 0, y: 390 } },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'po', kind: 'pass' },
                    { id: 'e2', source: 'po', target: 'build', kind: 'pass' },
                    { id: 'e3', source: 'build', target: 'end', kind: 'pass' },
                ],
            },
        },
    ];
}

/** Delivery as the Owner published it: its Build sub-workflow is the bundle ref `build`. */
export function makePublishedWorkflow(overrides: Partial<IPublishedWorkflowDetail> = {}): IPublishedWorkflowDetail {
    const delivery = makeTemplates()[1] as IWorkflowTemplate;
    return {
        id: 'pw-1',
        name: 'My delivery',
        description: 'Plans, then builds.',
        source_workflow_id: 'wf-1',
        input_kind: 'item',
        trigger: 'item_ready',
        push_code: true,
        raises_pr: true,
        push_to_default: false,
        agent_ids: ['agent-po-writer', 'agent-coder'],
        published_at: ISO,
        updated_at: ISO,
        graph: {
            ...delivery.graph,
            nodes: delivery.graph.nodes.map((n) => (n.type === 'subtasks' ? { ...n, sub_workflow_id: 'build' } : n)),
        },
        sub_workflows: [{ ref: 'build', name: 'My build' }],
        ...overrides,
    };
}
