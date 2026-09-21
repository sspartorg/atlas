import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import Box from '@mui/material/Box';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { makeWorkflow, stubReactFlowDom } from '../../test-utils/workflowFixtures.js';
import { toFlow } from './graph.js';
import type { ICanvasContext } from './WorkflowNodes.js';
import { WorkflowCanvas } from './WorkflowCanvas.js';

beforeAll(stubReactFlowDom);

const workflow = makeWorkflow();

function context(overrides: Partial<ICanvasContext> = {}): ICanvasContext {
    return {
        agentsById: new Map([
            ['agent-coder', makeAgent({ id: 'agent-coder', name: 'Coder' })],
            ['agent-reviewer', makeAgent({ id: 'agent-reviewer', name: 'Reviewer' })],
        ]),
        workflowsById: new Map(),
        errorNodeIds: new Set(),
        runStates: null,
        delivery: workflow,
        ...overrides,
    };
}

function mount(props: Partial<Parameters<typeof WorkflowCanvas>[0]> = {}) {
    const flow = toFlow(workflow.graph);
    renderWithProviders(
        <WorkflowCanvas nodes={flow.nodes} edges={flow.edges} context={context()} {...props} />
    );
    return screen.getByTestId('workflow-canvas');
}

/** A DataTransfer stand-in: jsdom ships no constructor for one. */
function dataTransfer(payload?: string) {
    return {
        dropEffect: 'none',
        effectAllowed: 'none',
        getData: vi.fn(() => payload ?? ''),
        setData: vi.fn(),
    } as unknown as DataTransfer & { dropEffect: string };
}

describe('WorkflowCanvas', () => {
    // Edges are not asserted here: ReactFlow only draws an edge once both its
    // nodes have been measured, and jsdom's no-op ResizeObserver never reports
    // a size. `graph.test.ts` covers the edge shapes the canvas is handed.
    it('draws every node of the graph it is handed, through its own node types', () => {
        const canvas = mount();
        expect(within(canvas).getByTestId('wf-node-coder')).toBeInTheDocument();
        expect(within(canvas).getByText('Reviewer')).toBeInTheDocument();
        expect(within(canvas).getByText('Start')).toBeInTheDocument();
        expect(canvas.querySelectorAll('.react-flow__node').length).toBe(4);
    });

    it('renders overlay children inside the canvas', () => {
        // The run view passes its legend in as a child; it has to land inside
        // the ReactFlow viewport so it floats over the graph.
        const canvas = mount({ children: <Box data-testid="overlay">Legend</Box> });
        expect(within(canvas).getByTestId('overlay')).toBeInTheDocument();
    });

    // Without preventDefault on dragover the browser refuses the drop
    // entirely, so dragging a palette chip onto the canvas would do nothing.
    it('accepts a palette drag and reports it as a move', () => {
        const canvas = mount();
        const transfer = dataTransfer();
        const event = createEvent.dragOver(canvas, { dataTransfer: transfer });
        fireEvent(canvas, event);
        expect(event.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('move');
    });

    it('hands the drop to its owner', () => {
        const onDrop = vi.fn();
        const canvas = mount({ onDrop });
        fireEvent.drop(canvas, { dataTransfer: dataTransfer('{"type":"owner"}') });
        expect(onDrop).toHaveBeenCalledTimes(1);
    });

    // On a phone the canvas is a read-only picture of the workflow: refusing
    // the dragover is what stops a drop landing at all, so the handler must
    // not be the only guard.
    it('refuses drags and drops when read-only', () => {
        const onDrop = vi.fn();
        const canvas = mount({ readOnly: true, onDrop });
        const transfer = dataTransfer();
        const event = createEvent.dragOver(canvas, { dataTransfer: transfer });
        fireEvent(canvas, event);
        expect(event.defaultPrevented).toBe(false);
        expect(transfer.dropEffect).toBe('none');

        fireEvent.drop(canvas, { dataTransfer: dataTransfer('{"type":"owner"}') });
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('lets nodes be dragged and selected by default', () => {
        expect(mount().querySelector('.react-flow__node')).toHaveClass('draggable', 'selectable');
    });

    // readOnly has to reach ReactFlow itself, not just the drop handler —
    // otherwise a phone user could still drag nodes around a graph they
    // cannot save.
    it('takes the drag and select affordances off the nodes when read-only', () => {
        const node = mount({ readOnly: true }).querySelector('.react-flow__node');
        expect(node).not.toHaveClass('draggable');
        expect(node).not.toHaveClass('selectable');
    });
});
