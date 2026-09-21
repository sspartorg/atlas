import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IAgent, IProject, IWorkflow, WorkflowNodeType } from '@atlas/shared';
import { makeAgent, makeProject } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { WorkflowInspector } from './WorkflowInspector.js';
import type { IWfNodeData, WfNode } from './graph.js';

/**
 * The inspector reads only `type` and `data` off the selected node, so a bare
 * ReactFlow node is enough — no canvas, and no `stubReactFlowDom`, because
 * the `graph.js` import here is type-only and erased at build time.
 */
function node(type: WorkflowNodeType, data: IWfNodeData = {}): WfNode {
    return { id: `n-${type}`, type, position: { x: 0, y: 0 }, data };
}

interface MountOptions {
    node?: WfNode | null;
    workflow?: Partial<IWorkflow>;
    agents?: IAgent[];
    workflows?: IWorkflow[];
    projects?: IProject[];
}

function mount(opts: MountOptions = {}) {
    const onChange = vi.fn();
    const onNodeData = vi.fn();
    renderWithProviders(
        <WorkflowInspector
            workflow={makeWorkflow(opts.workflow ?? {})}
            node={opts.node ?? null}
            agents={opts.agents ?? [makeAgent()]}
            projects={opts.projects ?? [makeProject()]}
            workflows={opts.workflows ?? []}
            onChange={onChange}
            onNodeData={onNodeData}
        />,
    );
    return { onChange, onNodeData };
}

/** MUI selects open on mousedown, not click. */
function openSelect(label: string) {
    fireEvent.mouseDown(screen.getByLabelText(label));
}

describe('WorkflowInspector', () => {
    // ─── Which panel the selection opens ────────────────────────────────────

    // With nothing selected the rail is the workflow's own settings — that is
    // where Name, trigger and Active live, so an empty rail here would leave
    // the Owner no way to reach them at all.
    it('falls back to the workflow settings when no node is selected', () => {
        mount({ node: null });
        expect(screen.getByRole('heading', { name: 'Workflow settings' })).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });

    it('titles each node type', () => {
        const titles: Array<[WorkflowNodeType, string]> = [
            ['agent', 'Agent step'],
            ['owner', 'Owner'],
            ['subtasks', 'Sub-tasks step'],
            ['end', 'End'],
        ];
        for (const [type, title] of titles) {
            const { unmount } = renderWithProviders(
                <WorkflowInspector
                    workflow={makeWorkflow()}
                    node={node(type)}
                    agents={[]}
                    projects={[]}
                    workflows={[]}
                    onChange={vi.fn()}
                    onNodeData={vi.fn()}
                />,
            );
            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
            unmount();
        }
    });

    it('explains that an Owner node parks the run and waits for a reply', () => {
        mount({ node: node('owner') });
        expect(screen.getByText(/comes back to you as Waiting for info/)).toBeInTheDocument();
    });

    // ─── Agent step ─────────────────────────────────────────────────────────

    it('shows the picked agent‘s CLI, model and effort, and links to it', () => {
        mount({
            node: node('agent', { agent_id: 'agent-coder' }),
            agents: [makeAgent({ id: 'agent-coder', name: 'Coder', cli: 'copilot', model: 'gpt-5', effort: 'high' })],
        });
        expect(screen.getByText('copilot')).toBeInTheDocument();
        expect(screen.getByText('gpt-5')).toBeInTheDocument();
        expect(screen.getByText('high')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Open agent/ })).toHaveAttribute('href', '/agents/agent-coder');
    });

    // A workflow installed from a template references catalog agent ids, and
    // the matching agent may not be installed. Falling back to the generic
    // "pick an agent" hint would hide that the step is already pointed at
    // something — the Owner would not know the graph is broken until it ran.
    it('names the missing agent when the step points at one that is not installed', () => {
        mount({
            node: node('agent', { agent_id: 'agent-po-writer' }),
            agents: [makeAgent({ id: 'agent-coder', name: 'Coder' })],
        });
        expect(screen.getByText(/agent-po-writer isn't installed/)).toBeInTheDocument();
        // The picker must not show the unresolvable id as if it were a choice.
        expect(screen.getByLabelText('Agent')).not.toHaveTextContent('agent-po-writer');
    });

    it('asks for an agent when the step has none yet', () => {
        mount({ node: node('agent') });
        expect(screen.getByText('Pick the agent this step runs.')).toBeInTheDocument();
    });

    it('patches the node data when an agent is picked', async () => {
        const { onNodeData } = mount({
            node: node('agent'),
            agents: [makeAgent({ id: 'agent-coder', name: 'Coder' }), makeAgent({ id: 'agent-rev', name: 'Reviewer' })],
        });
        openSelect('Agent');
        await userEvent.click(screen.getByRole('option', { name: 'Reviewer' }));
        expect(onNodeData).toHaveBeenCalledWith({ agent_id: 'agent-rev' });
    });

    // ─── Sub-tasks step ─────────────────────────────────────────────────────

    // A Sub-tasks step runs its sub-workflow on the parent Task's branch and
    // worktree, so a sub-workflow from another project would check out the
    // wrong repo; and only a `sub_task` workflow knows how to take one
    // sub-task as input. Both filters have to hold or the run breaks at
    // execution time, long after the Owner picked.
    it('offers only sub-task workflows from the same project', async () => {
        mount({
            workflow: { project_id: 'p1' },
            node: node('subtasks'),
            workflows: [
                makeWorkflow({ id: 'w-sub', name: 'Build sub-task', input_kind: 'sub_task', project_id: 'p1' }),
                makeWorkflow({ id: 'w-far', name: 'Other project sub', input_kind: 'sub_task', project_id: 'p2' }),
                makeWorkflow({ id: 'w-task', name: 'Task level', input_kind: 'item', project_id: 'p1' }),
            ],
        });
        openSelect('Sub-workflow');
        expect(await screen.findByRole('option', { name: 'Build sub-task' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Other project sub' })).toBeNull();
        expect(screen.queryByRole('option', { name: 'Task level' })).toBeNull();
    });

    // An empty picker with the everyday helper text reads as a loading state.
    // It isn't — it means the project has no sub-task workflow to run yet.
    it('says to create a sub-task workflow first when the project has none', () => {
        mount({ node: node('subtasks'), workflows: [] });
        expect(
            screen.getByText('Create a workflow with the Sub-task workflow input first'),
        ).toBeInTheDocument();
    });

    it('uses the everyday helper text once a sub-workflow exists', () => {
        mount({
            workflow: { project_id: 'p1' },
            node: node('subtasks'),
            workflows: [makeWorkflow({ id: 'w-sub', name: 'Build', input_kind: 'sub_task', project_id: 'p1' })],
        });
        expect(screen.getByText('Runs once per sub-task')).toBeInTheDocument();
    });

    it('links to the picked sub-workflow', () => {
        mount({
            workflow: { project_id: 'p1' },
            node: node('subtasks', { sub_workflow_id: 'w-sub' }),
            workflows: [makeWorkflow({ id: 'w-sub', name: 'Build', input_kind: 'sub_task', project_id: 'p1' })],
        });
        expect(screen.getByRole('link', { name: 'Open Build' })).toHaveAttribute('href', '/workflows/w-sub');
    });

    it('patches the sub-workflow id when one is picked', async () => {
        const { onNodeData } = mount({
            workflow: { project_id: 'p1' },
            node: node('subtasks'),
            workflows: [makeWorkflow({ id: 'w-sub', name: 'Build', input_kind: 'sub_task', project_id: 'p1' })],
        });
        openSelect('Sub-workflow');
        await userEvent.click(await screen.findByRole('option', { name: 'Build' }));
        expect(onNodeData).toHaveBeenCalledWith({ sub_workflow_id: 'w-sub' });
    });

    // An empty label is not the same as the string '': a Sub-tasks step with
    // no label claims every sub-task the labelled steps didn't, so the key has
    // to be cleared, not set to something no sub-task label will ever equal.
    it('clears an emptied label to undefined rather than an empty string', async () => {
        const { onNodeData } = mount({
            workflow: { project_id: 'p1' },
            node: node('subtasks', { label: 'ui' }),
        });
        await userEvent.clear(screen.getByLabelText('Label'));
        expect(onNodeData.mock.calls.at(-1)?.[0]).toStrictEqual({ label: undefined });
    });

    it('patches a typed label', async () => {
        const { onNodeData } = mount({ workflow: { project_id: 'p1' }, node: node('subtasks') });
        await userEvent.type(screen.getByLabelText('Label'), 'ui');
        expect(onNodeData).toHaveBeenCalledWith({ label: 'u' });
    });

    // ─── End step ───────────────────────────────────────────────────────────

    // A sub-task never delivers on its own — its work rides the parent Task's
    // branch and the Task's End does the push. Showing delivery cards here
    // would offer a per-sub-task push that ADR 0015 rules out.
    it('offers no delivery choice on a sub-task workflow', () => {
        mount({ node: node('end'), workflow: { input_kind: 'sub_task' } });
        expect(screen.getByText(/its work stays on the Task's branch/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Push \+ pull request/ })).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('selects the delivery card matching the workflow flags', () => {
        const cases: Array<[Partial<IWorkflow>, RegExp]> = [
            [{ push_code: true, raises_pr: true, push_to_default: false }, /Push \+ pull request/],
            [{ push_code: true, raises_pr: false, push_to_default: false }, /Push branch/],
            [{ push_code: true, raises_pr: false, push_to_default: true }, /Push to the default branch/],
            [{ push_code: false, raises_pr: false, push_to_default: false }, /Keep local/],
        ];
        for (const [flags, selected] of cases) {
            const { unmount } = renderWithProviders(
                <WorkflowInspector
                    workflow={makeWorkflow(flags)}
                    node={node('end')}
                    agents={[]}
                    projects={[]}
                    workflows={[]}
                    onChange={vi.fn()}
                    onNodeData={vi.fn()}
                />,
            );
            expect(screen.getByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true');
            // Exactly one card is ever selected.
            expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
            unmount();
        }
    });

    // `push_to_default` wins over `raises_pr` when both are set, which is the
    // state a half-applied patch leaves behind. Reading it as "pull request"
    // would show a review step that never happens.
    it('reads a push-to-default workflow as publishing straight to the default branch', () => {
        mount({ node: node('end'), workflow: { push_code: true, raises_pr: true, push_to_default: true } });
        expect(screen.getByRole('button', { name: /Push to the default branch/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Push \+ pull request/ })).toHaveAttribute('aria-pressed', 'false');
    });

    // Each card patches all three delivery flags together. A patch that only
    // set the flag it turns on would leave the previous mode's flag standing —
    // switching PR → push branch would keep opening pull requests.
    it('rewrites every delivery flag when the mode changes', async () => {
        const { onChange } = mount({
            node: node('end'),
            workflow: { push_code: true, raises_pr: true, push_to_default: false },
        });
        await userEvent.click(screen.getByRole('button', { name: /Push branch/ }));
        expect(onChange).toHaveBeenCalledWith({ push_code: true, raises_pr: false, push_to_default: false });
    });

    it('clears the PR flag when publishing straight to the default branch', async () => {
        const { onChange } = mount({
            node: node('end'),
            workflow: { push_code: true, raises_pr: true, push_to_default: false },
        });
        await userEvent.click(screen.getByRole('button', { name: /Push to the default branch/ }));
        expect(onChange).toHaveBeenCalledWith({ push_code: true, raises_pr: false, push_to_default: true });
    });

    it('turns every push flag off for a local-only workflow', async () => {
        const { onChange } = mount({
            node: node('end'),
            workflow: { push_code: true, raises_pr: true, push_to_default: false },
        });
        await userEvent.click(screen.getByRole('button', { name: /Keep local/ }));
        expect(onChange).toHaveBeenCalledWith({ push_code: false, raises_pr: false, push_to_default: false });
    });

    it('toggles the shared worktree', async () => {
        const { onChange } = mount({ node: node('end'), workflow: { use_worktree: true } });
        const toggle = screen.getByRole('switch', { name: /Use a worktree/ });
        expect(toggle).toBeChecked();
        await userEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith({ use_worktree: false });
    });

    // G-010 — the accessible name must be the bare label. This was written
    // because `inputProps` was used to set it, and MUI 7 silently drops that
    // prop on Switch (it wants `slotProps.input`): the name fell through to
    // the wrapping <label> and a screen reader read the heading and its help
    // text as one string. Reverting to `inputProps` fails this exactly.
    it('gives the toggle the bare label as its accessible name, not the help text too', () => {
        mount({ node: node('end'), workflow: { use_worktree: true } });
        expect(screen.getByRole('switch', { name: 'Use a worktree' })).toBeInTheDocument();
        expect(
            screen.queryByRole('switch', { name: /All steps share one checkout/ }),
        ).toBeNull();
    });
});
