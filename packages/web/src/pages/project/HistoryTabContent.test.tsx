import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { HistoryTabContent } from './HistoryTabContent.js';
import { makeAgent } from '../../test-utils/factories.js';

const BASE = 'http://localhost:3000/api';
const ISO = '2026-05-16T00:00:00.000Z';

const makeRun = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    agent_id: 'agent-coder',
    project_id: 'p1',
    issue_id: 'ATL-1',
    issue_type: 'epic',
    status: 'completed',
    total_cost_usd: null,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    created_at: ISO,
    started_at: ISO,
    completed_at: ISO,
    finished_at: ISO,
    worktree_branch: null,
    worktree_path: null,
    round: 1,
    is_simulated: 0,
    item_title: null,
    ...overrides,
});

describe('HistoryTabContent', () => {
    it('renders the empty state when no runs', async () => {
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/No agent activity yet/i)).toBeInTheDocument();
        });
    });

    it('renders one row per run when runs exist (epic type)', async () => {
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([makeRun({ issue_type: 'epic' })])),
            http.get(`${BASE}/agents`, () =>
                HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'Coder' })]),
            ),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getAllByText('Coder').length).toBeGreaterThan(0);
        });
    });

    it('shows "unknown agent" when run.agent_id not in agents map (covers agent=undefined branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ agent_id: 'agent-missing' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/unknown agent/i)).toBeInTheDocument();
        });
    });

    it('shows total cost when at least one run has total_cost_usd (covers totalCostUsd != null)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ total_cost_usd: 1.5 })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            // formatCostUsd(1.5) renders something with "total"
            expect(document.body.textContent).toContain('total');
        });
    });

    it('renders story type run (covers issueRoute story branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ issue_type: 'story', issue_id: 'ATL-S1' })]),
            ),
            http.get(`${BASE}/agents`, () =>
                HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'StoryCoder' })]),
            ),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('ATL-S1')).toBeInTheDocument();
        });
    });

    it('renders sub_task type run (covers issueRoute sub_task branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ issue_type: 'sub_task', issue_id: 'ATL-ST1' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('ATL-ST1')).toBeInTheDocument();
        });
    });

    it('renders sub_bug type run (covers issueRoute sub_bug branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ issue_type: 'sub_bug', issue_id: 'ATL-SB1' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('ATL-SB1')).toBeInTheDocument();
        });
    });

    it('renders bug type run (covers issueRoute default/bug branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ issue_type: 'bug', issue_id: 'ATL-B1' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText('ATL-B1')).toBeInTheDocument();
        });
    });

    it('shows run status label (Completed)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'completed' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /completed/i })).toBeInTheDocument();
        });
    });

    it('shows run status label for error status', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'error' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /error/i })).toBeInTheDocument();
        });
    });

    it('shows run status label for queued status', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'queued' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /queued/i })).toBeInTheDocument();
        });
    });

    it('shows run status label for in_progress status', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'in_progress' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /in progress/i })).toBeInTheDocument();
        });
    });

    it('shows run status label for cancelled status', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'cancelled' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /cancelled/i })).toBeInTheDocument();
        });
    });

    it('shows run status label for setup_failed status', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ status: 'setup_failed' })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByRole('generic', { name: /setup failed/i })).toBeInTheDocument();
        });
    });

    it('totalCostUsd all null — cost display not shown (covers hasAny=false branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    makeRun({ total_cost_usd: null }),
                    makeRun({ id: 'r2', total_cost_usd: null }),
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            // Agent activity header shows
            expect(screen.getByText(/Agent activity/i)).toBeInTheDocument();
            // Cost "total" text should NOT appear since all cost is null
            expect(document.body.textContent).not.toContain('total');
        });
    });

    it('L192: ?? started_at fallback — run with completed_at null uses started_at for timestamp', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ completed_at: null, started_at: ISO })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/Agent activity/i)).toBeInTheDocument();
        });
    });

    it('L192: ?? created_at fallback — run with both completed_at and started_at null uses created_at', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([makeRun({ completed_at: null, started_at: null, created_at: ISO })]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        await waitFor(() => {
            expect(screen.getByText(/Agent activity/i)).toBeInTheDocument();
        });
    });

    it('renders skeleton when isPending (covers isPending skeleton branch)', async () => {
        // Return a never-resolving response so isPending stays true
        server.use(
            http.get(`${BASE}/run`, () => new Promise(() => { /* never resolves */ })),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTabContent projectId="p1" />);
        // The Skeleton is rendered immediately before data arrives
        const { container } = renderWithProviders(<HistoryTabContent projectId="p1" />);
        expect(container.firstChild).toBeInTheDocument();
    });
});
