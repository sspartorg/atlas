import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IAgent } from '@atlas/shared';
import { makeAgent } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { NodePalette, PALETTE_MIME } from './NodePalette.js';

const AGENTS = [
    makeAgent({ id: 'agent-coder', name: 'Coder' }),
    makeAgent({ id: 'agent-reviewer', name: 'Code Reviewer' }),
];

function mount(opts: { agents?: IAgent[]; showSubtasks?: boolean } = {}) {
    const onAdd = vi.fn();
    renderWithProviders(
        <NodePalette agents={opts.agents ?? AGENTS} showSubtasks={opts.showSubtasks ?? true} onAdd={onAdd} />,
    );
    return onAdd;
}

describe('NodePalette', () => {
    it('lists the flow chips and one chip per installed agent', () => {
        mount();
        expect(screen.getByRole('button', { name: 'Add Owner' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add End' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Coder' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Code Reviewer' })).toBeInTheDocument();
    });

    // Sub-tasks steps only exist inside a workflow that runs on a Task. Offering
    // one in a sub-task workflow would let the Owner build a graph that recurses
    // into itself, which the builder has no way to run.
    it('hides the Sub-tasks chip when the workflow cannot hold one', () => {
        mount({ showSubtasks: false });
        expect(screen.queryByRole('button', { name: 'Add Sub-tasks' })).toBeNull();
        // The other flow chips are unaffected.
        expect(screen.getByRole('button', { name: 'Add Owner' })).toBeInTheDocument();
    });

    it('offers the Sub-tasks chip on a Task workflow', () => {
        mount({ showSubtasks: true });
        expect(screen.getByRole('button', { name: 'Add Sub-tasks' })).toBeInTheDocument();
    });

    // ─── Adding a node ──────────────────────────────────────────────────────
    //
    // Clicking is not a convenience duplicate of dragging: HTML5 drag-and-drop
    // never fires on touch, so a broken click handler makes the palette
    // unusable on a tablet with no other way in.

    it('adds a flow node with no agent attached when its chip is clicked', async () => {
        const onAdd = mount();
        await userEvent.click(screen.getByRole('button', { name: 'Add Owner' }));
        expect(onAdd).toHaveBeenCalledWith({ type: 'owner' });
    });

    it('carries the agent id when an agent chip is clicked', async () => {
        const onAdd = mount();
        await userEvent.click(screen.getByRole('button', { name: 'Add Code Reviewer' }));
        expect(onAdd).toHaveBeenCalledWith({ type: 'agent', agent_id: 'agent-reviewer' });
    });

    // The chips are `role="button"` on a Box, so they get no native keyboard
    // activation — losing the handler silently makes the palette mouse-only.
    it('adds the node on Enter and on Space', async () => {
        const onAdd = mount();
        const chip = screen.getByRole('button', { name: 'Add End' });
        chip.focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onAdd).toHaveBeenCalledTimes(2);
        expect(onAdd).toHaveBeenNthCalledWith(1, { type: 'end' });
        expect(onAdd).toHaveBeenNthCalledWith(2, { type: 'end' });
    });

    it('ignores other keys', async () => {
        const onAdd = mount();
        screen.getByRole('button', { name: 'Add End' }).focus();
        await userEvent.keyboard('{Escape}');
        expect(onAdd).not.toHaveBeenCalled();
    });

    // The canvas reads the drop payload back off this exact MIME type; a
    // mismatch here drops the node on the floor with no error anywhere.
    it('writes the node payload onto the drag event under the palette MIME type', () => {
        mount();
        const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
        fireEvent.dragStart(screen.getByRole('button', { name: 'Add Coder' }), { dataTransfer });
        expect(dataTransfer.setData).toHaveBeenCalledWith(
            PALETTE_MIME,
            JSON.stringify({ type: 'agent', agent_id: 'agent-coder' }),
        );
        expect(dataTransfer.effectAllowed).toBe('move');
    });

    // ─── Search ─────────────────────────────────────────────────────────────

    it('narrows the agent chips to the query, ignoring case and stray spaces', async () => {
        mount();
        await userEvent.type(screen.getByLabelText('Search agents'), '  REVIEW ');
        expect(screen.getByRole('button', { name: 'Add Code Reviewer' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add Coder' })).toBeNull();
        // The search filters agents only — the flow chips stay reachable.
        expect(screen.getByRole('button', { name: 'Add Owner' })).toBeInTheDocument();
    });

    // "no agents installed" and "nothing matched your search" need different
    // answers: one sends the Owner to the agent library, the other to the
    // search box. Collapsing them into one message strands whoever gets it.
    it('tells the Owner nothing matched when the query filters everything out', async () => {
        mount();
        await userEvent.type(screen.getByLabelText('Search agents'), 'zzz');
        expect(screen.getByText('No agents match.')).toBeInTheDocument();
        expect(screen.queryByText('No agents installed.')).toBeNull();
    });

    it('tells the Owner to install an agent when none exist at all', () => {
        mount({ agents: [] });
        expect(screen.getByText('No agents installed.')).toBeInTheDocument();
        expect(screen.queryByText('No agents match.')).toBeNull();
    });
});
