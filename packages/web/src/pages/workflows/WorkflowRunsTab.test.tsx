import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IWorkflowRunSummary } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeRunDetail } from '../../test-utils/workflowFixtures.js';
import { WorkflowRunsTab } from './WorkflowRunsTab.js';

const BASE = 'http://localhost:3000/api';
const WF = 'wf-1';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));

// `IWorkflowRunDetail extends IWorkflowRunSummary`, so the detail factory
// supplies every field this list row reads; the extra keys are ignored.
function makeRun(overrides: Partial<IWorkflowRunSummary> = {}): IWorkflowRunSummary {
    return { ...makeRunDetail(), ...overrides } as IWorkflowRunSummary;
}

function mount(runs: IWorkflowRunSummary[] | null, opts: { status?: number } = {}) {
    server.use(
        http.get(`${BASE}/workflows/${WF}/runs`, () =>
            opts.status
                ? new HttpResponse(null, { status: opts.status })
                : HttpResponse.json(runs ?? []),
        ),
    );
    navigate.mockClear();
    return renderWithProviders(<WorkflowRunsTab workflowId={WF} />);
}

describe('WorkflowRunsTab', () => {
    it('shows the empty state when the workflow has never run', async () => {
        mount([]);
        expect(await screen.findByText(/No runs yet/i)).toBeInTheDocument();
    });

    it('surfaces a load failure instead of rendering an empty table', async () => {
        // An empty table and a failed fetch look identical to the Owner
        // otherwise — "no runs" would be a lie told by a 500.
        mount(null, { status: 500 });
        expect(await screen.findByText(/Couldn't load runs/i)).toBeInTheDocument();
    });

    it('renders a row per run with its item title and id', async () => {
        mount([
            makeRun({ id: 'run-a', item_id: 'ATL-1', item_title: 'Add the thing' }),
            makeRun({ id: 'run-b', item_id: 'ATL-2', item_title: 'Fix the other thing' }),
        ]);
        expect(await screen.findByText('Add the thing')).toBeInTheDocument();
        expect(screen.getByText('ATL-2')).toBeInTheDocument();
    });

    it('labels a project-level run and falls back to a short run id', async () => {
        // A run with no item is a project-level run; it has no key to show.
        mount([makeRun({ id: 'abcdef1234567890', item_id: null, item_title: null })]);
        expect(await screen.findByText('Project run')).toBeInTheDocument();
        expect(screen.getByText('abcdef12')).toBeInTheDocument();
    });

    // ─── F-018: one Task, many PRs (ADR 0017/0018) ──────────────────────────
    //
    // A multi-repo run opens a PR per repo it changed. `pr_url` holds only the
    // first, so rendering that alone silently dropped the rest — the exact
    // regression F-018 recorded, where a two-repo run linked PR #19 and hid #2.

    it('links every PR a multi-repo run opened, numbered', async () => {
        mount([
            makeRun({
                pr_url: 'https://github.com/o/core/pull/19',
                pr_urls: ['https://github.com/o/core/pull/19', 'https://github.com/o/web/pull/2'],
            }),
        ]);
        expect(await screen.findByText('PR 1 of 2')).toBeInTheDocument();
        expect(screen.getByText('PR 2 of 2')).toBeInTheDocument();
        // Each link points at its own repo, not twice at the first.
        expect(screen.getByText('PR 2 of 2')).toHaveAttribute(
            'href',
            'https://github.com/o/web/pull/2',
        );
    });

    it('says "Open PR" rather than "PR 1 of 1" for a single-repo run', async () => {
        mount([makeRun({ pr_url: 'https://github.com/o/core/pull/19', pr_urls: ['https://github.com/o/core/pull/19'] })]);
        expect(await screen.findByText('Open PR')).toBeInTheDocument();
    });

    it('falls back to pr_url for runs recorded before pr_urls existed', async () => {
        // Migration 003 backfilled, but a run whose pr_urls is empty must still
        // link — otherwise the fix would erase history it was meant to preserve.
        mount([makeRun({ pr_url: 'https://github.com/o/core/pull/7', pr_urls: [] })]);
        const link = await screen.findByText('Open PR');
        expect(link).toHaveAttribute('href', 'https://github.com/o/core/pull/7');
    });

    it('shows a dash when a run opened no PR at all', async () => {
        mount([makeRun({ item_id: 'ATL-3', item_title: 'No PR run', pr_url: null, pr_urls: [] })]);
        expect(await screen.findByText('—')).toBeInTheDocument();
    });

    // ─── Row navigation ─────────────────────────────────────────────────────

    it('opens the run detail when the row is clicked', async () => {
        mount([makeRun({ id: 'run-a', item_id: 'ATL-9', item_title: 'Clickable row' })]);
        await userEvent.click(await screen.findByText('Clickable row'));
        expect(navigate).toHaveBeenCalledWith(`/workflows/${WF}/runs/run-a`);
    });

    it('does not navigate when the PR link itself is clicked', async () => {
        // The link opens GitHub in a new tab; without stopPropagation the row
        // handler also fires and the Owner loses their place.
        mount([makeRun({ item_id: 'ATL-4', item_title: 'Link row', pr_url: 'https://github.com/o/core/pull/7', pr_urls: [] })]);
        await userEvent.click(await screen.findByText('Open PR'));
        await waitFor(() => expect(navigate).not.toHaveBeenCalled());
    });
});
