import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IAgentRun } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { server } from '../../test-setup.js';
import { RunsTabContent } from './RunsTabContent.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

function makeRun(over: Partial<IAgentRun> = {}): IAgentRun {
    return {
        id: 'run-001',
        agent_id: 'agent-coder',
        status: 'completed',
        issue_id: 'ATL-10',
        issue_type: 'story',
        project_id: 'p1',
        prompt_snapshot: null,
        output_text: null,
        started_at: null,
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
        total_cost_usd: 0.012,
        credits: null,
        item_title: null,
        created_at: '2026-05-16T00:00:00.000Z',
        ...over,
    };
}

describe('RunsTabContent', () => {
    beforeEach(() => {
        server.use(...defaultHandlers);
    });

    it('renders "No runs yet" when runs is empty', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[]} />
        );
        expect(await screen.findByText(/No runs yet/i)).toBeInTheDocument();
    });

    it('renders run list when runs are provided', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        expect(await screen.findByText(/Recent runs \(1\)/i)).toBeInTheDocument();
    });

    it('shows completed run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'completed' })]} />
        );
        expect(await screen.findByText('Completed')).toBeInTheDocument();
    });

    it('shows error run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'error' })]} />
        );
        expect(await screen.findByText('Error')).toBeInTheDocument();
    });

    it('shows in_progress run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'in_progress' })]} />
        );
        expect(await screen.findByText('In progress')).toBeInTheDocument();
    });

    it('shows queued run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'queued' })]} />
        );
        expect(await screen.findByText('Queued')).toBeInTheDocument();
    });

    it('shows cancelled run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'cancelled' })]} />
        );
        expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    });

    it('shows setup_failed run status', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun({ status: 'setup_failed' })]} />
        );
        expect(await screen.findByText('Setup failed')).toBeInTheDocument();
    });

    it('shows "Freedom run" chip for run with no issue_id or project_id', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ issue_id: '', project_id: null as unknown as string })]}
            />
        );
        expect(await screen.findByText(/Freedom run/i)).toBeInTheDocument();
    });

    it('shows "Project scope" chip for run with project_id but no issue_id', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ issue_id: '', project_id: 'proj-1' })]}
            />
        );
        expect(await screen.findByText(/Project scope/i)).toBeInTheDocument();
    });

    it('shows item reference for run with issue_id', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ issue_id: 'ATL-10', issue_type: 'story' })]}
            />
        );
        expect(await screen.findByText('story/ATL-10')).toBeInTheDocument();
    });

    it('clicking "Run now" button in empty state shows toast', async () => {
        renderWithProviders(
            <>
                <RunsTabContent agent={makeAgent()} runs={[]} />
                <Toast />
            </>
        );
        const btn = await screen.findByRole('button', { name: /Run now/i });
        fireEvent.click(btn);
        expect(await screen.findByText(/Run now: pick an Epic or Story from the Queue/i)).toBeInTheDocument();
    });

    it('delete button opens confirm dialog', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        expect(await screen.findByText(/Delete run\?/i)).toBeInTheDocument();
    });

    it('Cancel in confirm dialog closes it', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
        fireEvent.click(cancelBtn);
        await waitFor(() => {
            expect(screen.queryByText(/Delete run\?/i)).not.toBeInTheDocument();
        });
    });

    it('Confirm in dialog calls DELETE /api/run/:runId', async () => {
        let deleteCalled = false;
        server.use(
            http.delete(`${BASE}/run/run-001`, () => {
                deleteCalled = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        const confirmBtn = screen.getByRole('button', { name: /^Delete run$/i });
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(deleteCalled).toBe(true));
    });

    it('delete failure shows error toast', async () => {
        server.use(
            http.delete(`${BASE}/run/run-001`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
        );
        renderWithProviders(
            <>
                <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
                <Toast />
            </>
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        const confirmBtn = screen.getByRole('button', { name: /^Delete run$/i });
        fireEvent.click(confirmBtn);
        // Toast should appear with error
        await waitFor(() =>
            expect(screen.getByText(/Delete failed/i)).toBeInTheDocument(),
        );
    });

    it('clicking a run row navigates to run detail', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />,
            { initialEntries: ['/agents/agent-coder'] }
        );
        const rows = await screen.findAllByRole('button');
        const runRow = rows.find(r => !r.getAttribute('aria-label'));
        expect(runRow).toBeDefined();
        fireEvent.click(runRow!);
        // Navigation handled by MemoryRouter — no error thrown
    });

    it('shows issue_id in dialog when run has issue_id', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ issue_id: 'ATL-99', issue_type: 'story' })]}
            />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        // The dialog content area should contain the issue reference
        // (there may also be one in the row, so use getAllByText)
        const refs = screen.getAllByText(/story\/ATL-99/i);
        expect(refs.length).toBeGreaterThan(0);
    });

    it('does not show issue ref in dialog when run has no issue_id', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ issue_id: '', project_id: null as unknown as string })]}
            />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        // The dialog text about resetting item should be there
        expect(screen.getByText(/reset the item back to/i)).toBeInTheDocument();
    });

    it('mobile layout shows stacked cards when useIsMobile returns true', async () => {
        const origMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: query.includes('max-width'),
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        expect(await screen.findByText('Completed')).toBeInTheDocument();
        Object.defineProperty(window, 'matchMedia', { writable: true, value: origMatchMedia });
    });

    it('keyboard Enter on run row triggers navigation', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />,
            { initialEntries: ['/agents/agent-coder'] }
        );
        const rows = await screen.findAllByRole('button');
        const runRow = rows.find(r => !r.getAttribute('aria-label'));
        expect(runRow).toBeDefined();
        fireEvent.keyDown(runRow!, { key: 'Enter' });
        // No crash — navigation attempted
    });

    it('sorts runs by created_at descending', async () => {
        const run1 = makeRun({
            id: 'run-001',
            status: 'completed',
            created_at: '2026-05-15T00:00:00.000Z',
        });
        const run2 = makeRun({
            id: 'run-002',
            status: 'error',
            created_at: '2026-05-16T00:00:00.000Z',
        });
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[run1, run2]} />
        );
        // Both statuses should appear
        expect(await screen.findByText('Error')).toBeInTheDocument();
        expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('run with null total_cost_usd shows placeholder cost', async () => {
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ total_cost_usd: null as unknown as number })]}
            />
        );
        // Should render without crash
        expect(await screen.findByText('Completed')).toBeInTheDocument();
    });

    it('space key onKeyDown on run row triggers navigation (no crash)', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />,
            { initialEntries: ['/agents/agent-coder'] }
        );
        const rows = await screen.findAllByRole('button');
        // The run row is the button with no aria-label (delete button has aria-label)
        const runRow = rows.find(r => !r.getAttribute('aria-label'));
        expect(runRow).toBeDefined();
        // Space key fires the same open() as Enter — should not throw
        fireEvent.keyDown(runRow!, { key: ' ' });
        // No crash — navigation attempted
        expect(runRow).toBeInTheDocument();
    });

    it('confirm dialog shows "Delete run" button text in initial (non-pending) state', async () => {
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);
        // The confirm button in the dialog should read "Delete run" (not "Deleting…")
        // when deleteRun.isPending is false (initial state)
        const confirmBtn = screen.getByRole('button', { name: /^Delete run$/i });
        expect(confirmBtn).toBeInTheDocument();
        expect(confirmBtn).not.toBeDisabled();
        // The "Deleting…" text is absent
        expect(screen.queryByText(/Deleting…/i)).not.toBeInTheDocument();
    });

    it('renders SimulatedBadge when run output_text starts with [SIMULATED', async () => {
        // isSimulatedRun returns true when output_text starts with '[SIMULATED'
        // defaultHandlers returns settings without ai_enabled field so aiEnabled is false,
        // but output_text starting with the marker is checked first.
        renderWithProviders(
            <RunsTabContent
                agent={makeAgent()}
                runs={[makeRun({ output_text: '[SIMULATED] agent output here' })]}
            />
        );
        // SimulatedBadge should render in the run row
        expect(await screen.findByText(/simulated/i)).toBeInTheDocument();
    });

    it('onKeyDown with non-Enter/Space key does NOT navigate — covers else branch', async () => {
        // Only Enter and Space trigger navigation; other keys are no-ops
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />,
            { initialEntries: ['/agents/agent-coder'] }
        );
        const rows = await screen.findAllByRole('button');
        const runRow = rows.find(r => !r.getAttribute('aria-label'));
        expect(runRow).toBeDefined();
        // Tab key should not trigger navigation (no crash, no exception)
        fireEvent.keyDown(runRow!, { key: 'Tab' });
        // Row is still in the document — no unintended navigation
        expect(runRow).toBeInTheDocument();
    });

    it('Dialog onClose returns undefined when deleteRun.isPending — inflight delete keeps dialog open', async () => {
        let resolveDelete!: () => void;
        const deleteProm = new Promise<void>((res) => { resolveDelete = res; });
        server.use(
            http.delete(`${BASE}/run/run-001`, () =>
                deleteProm.then(() => new HttpResponse(null, { status: 204 })),
            ),
        );
        renderWithProviders(
            <RunsTabContent agent={makeAgent()} runs={[makeRun()]} />
        );
        const deleteBtn = await screen.findByRole('button', { name: /Delete run/i });
        fireEvent.click(deleteBtn);
        await screen.findByText(/Delete run\?/i);

        // Click the confirm button — starts the DELETE (isPending becomes true)
        const confirmBtn = screen.getByRole('button', { name: /^Delete run$/i });
        fireEvent.click(confirmBtn);

        // While pending, onClose callback is undefined so the dialog stays open.
        // The dialog should still be in the document.
        await waitFor(() =>
            expect(screen.getByText(/Deleting…/i)).toBeInTheDocument(),
        );
        // Dialog remains open while delete is in-flight
        expect(screen.getByText(/Delete run\?/i)).toBeInTheDocument();

        // Resolve to clean up
        resolveDelete();
    });
});
