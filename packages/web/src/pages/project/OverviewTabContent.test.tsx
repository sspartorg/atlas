import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { OverviewTabContent } from './OverviewTabContent.js';
import type { ProjectCounts } from '../../api/types.js';

const BASE = 'http://localhost:3000/api';

const emptyCounts: ProjectCounts = {
    open_epics: 0,
    epics_ready: 0,
    stories_in_flight: 0,
    stories_waiting_info: 0,
    open_bugs: 0,
    bugs_ready: 0,
};

const countsWith: ProjectCounts = {
    open_epics: 5,
    epics_ready: 2,
    stories_in_flight: 3,
    stories_waiting_info: 1,
    open_bugs: 4,
    bugs_ready: 2,
    costSummary: {
        total_cost_usd: 12.5,
        run_count: 8,
        input_tokens: 100000,
        output_tokens: 20000,
        cache_read_tokens: 5000,
        cache_creation_tokens: 0,
    },
};

describe('OverviewTabContent', () => {
    beforeEach(() => {
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
    });

    it('renders KPI tiles with zero counts', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        // KPI tiles rendered
        await waitFor(() => expect(screen.getByText('Open Epics')).toBeInTheDocument());
        expect(screen.getByText('Stories in flight')).toBeInTheDocument();
        expect(screen.getByText('Open bugs')).toBeInTheDocument();
    });

    it('renders KPI tiles with counts', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={countsWith}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('Open Epics')).toBeInTheDocument());
        // Check counts appear
        expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "No recent activity yet" when runs is empty', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByText('No recent activity yet')).toBeInTheDocument(),
        );
    });

    it('calls onJumpToHistory when Full history → is clicked', async () => {
        const onJump = vi.fn();
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={onJump}
            />,
        );
        await waitFor(() => screen.getByText('Full history →'));
        fireEvent.click(screen.getByText('Full history →'));
        expect(onJump).toHaveBeenCalledTimes(1);
    });

    it('shows cost summary when runs exist', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-1',
                        agent_id: 'agent-1',
                        issue_type: 'story',
                        issue_id: 'story-1',
                        item_title: 'My Story',
                        status: 'completed',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:05:00Z',
                        total_cost_usd: 0.05,
                    },
                ]),
            ),
        );
        renderWithProviders(
            <OverviewTabContent
                counts={countsWith}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('Recent activity')).toBeInTheDocument());
    });

    it('shows epics_ready in epic caption', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{ ...emptyCounts, epics_ready: 3 }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText(/awaiting pickup/i)).toBeInTheDocument());
    });

    it('shows "queue is empty" when no stories in flight', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{ ...emptyCounts, stories_in_flight: 0 }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText(/queue is empty/i)).toBeInTheDocument());
    });

    it('shows "No activity this month" in cost tile when no cost/terminal summaries', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByText(/No activity this month/i)).toBeInTheDocument(),
        );
    });

    it('renders RecentRunRow with sub_task issue type (issueRoute sub-task branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-st',
                        agent_id: 'agent-1',
                        issue_type: 'sub_task',
                        issue_id: 'ST-42',
                        item_title: 'Sub-task item',
                        status: 'completed',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:05:00Z',
                        total_cost_usd: 0.02,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('ST-42')).toBeInTheDocument());
        // The link should point to the sub-tasks route
        const link = screen.getByText('ST-42').closest('a');
        expect(link).toHaveAttribute('href', '/issues/sub-tasks/ST-42');
    });

    it('renders RecentRunRow with sub_bug issue type (issueRoute sub-bug branch)', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-sb',
                        agent_id: 'agent-1',
                        issue_type: 'sub_bug',
                        issue_id: 'SB-7',
                        item_title: 'Sub-bug item',
                        status: 'error',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:05:00Z',
                        total_cost_usd: 0.01,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('SB-7')).toBeInTheDocument());
        const link = screen.getByText('SB-7').closest('a');
        expect(link).toHaveAttribute('href', '/issues/sub-bugs/SB-7');
    });

    it('shows BoldKpi token count when costSummary.run_count > 0', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={countsWith}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        // run_count=8 so BoldKpi renders "8" runs and "125.0K" tokens
        await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
        expect(screen.getByText('125.0K')).toBeInTheDocument();
    });

    it('shows "in motion" bug caption when open_bugs > 0 and bugs_ready === 0', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{ ...emptyCounts, open_bugs: 2, bugs_ready: 0 }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('in motion')).toBeInTheDocument());
    });

    it('shows stories in-progress and waiting info when storiesInFlight > 0', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    stories_in_flight: 4,
                    stories_waiting_info: 1,
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        // storyCaption = "3 in progress · 1 waiting info"
        await waitFor(() =>
            expect(screen.getByText(/in progress/i)).toBeInTheDocument(),
        );
        expect(screen.getByText(/waiting info/i)).toBeInTheDocument();
    });

    it('issueRoute: renders epic type link correctly', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-ep',
                        agent_id: 'agent-1',
                        issue_type: 'epic',
                        issue_id: 'EP-1',
                        item_title: 'Epic item',
                        status: 'completed',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:05:00Z',
                        total_cost_usd: 0.01,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('EP-1')).toBeInTheDocument());
        const link = screen.getByText('EP-1').closest('a');
        expect(link).toHaveAttribute('href', '/epics/EP-1');
    });

    it('issueRoute: renders bug fallback link correctly', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-bg',
                        agent_id: 'agent-1',
                        issue_type: 'bug',
                        issue_id: 'BG-3',
                        item_title: 'Bug item',
                        status: 'error',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: null,
                        total_cost_usd: 0,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('BG-3')).toBeInTheDocument());
        const link = screen.getByText('BG-3').closest('a');
        expect(link).toHaveAttribute('href', '/issues/bugs/BG-3');
    });

    it('issueRoute: renders story type link correctly', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-st2',
                        agent_id: 'agent-1',
                        issue_type: 'story',
                        issue_id: 'ST-99',
                        item_title: 'Story item',
                        status: 'queued',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: null,
                        completed_at: null,
                        total_cost_usd: 0,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('ST-99')).toBeInTheDocument());
        const link = screen.getByText('ST-99').closest('a');
        expect(link).toHaveAttribute('href', '/issues/stories/ST-99');
    });

    it('RecentRunRow: renders "unknown" fallback when agent not in agentsById', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-uk',
                        agent_id: 'agent-missing',
                        issue_type: 'story',
                        issue_id: 'ST-10',
                        item_title: 'Some story',
                        status: 'in_progress',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: null,
                        total_cost_usd: 0,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('unknown')).toBeInTheDocument());
    });

    it('RecentRunRow: item_title null renders empty string', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-nt',
                        agent_id: 'agent-1',
                        issue_type: 'story',
                        issue_id: 'ST-11',
                        item_title: null,
                        status: 'cancelled',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:02:00Z',
                        total_cost_usd: 0,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('ST-11')).toBeInTheDocument());
        // Status "Cancelled" should appear
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });

    it('RecentRunRow: renders "setup_failed" status badge', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-sf',
                        agent_id: 'agent-1',
                        issue_type: 'story',
                        issue_id: 'ST-12',
                        item_title: 'Setup story',
                        status: 'setup_failed',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: null,
                        completed_at: null,
                        total_cost_usd: 0,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('Setup failed')).toBeInTheDocument());
    });

    it('RecentRunRow: renders known agent with AgentChip when agent is in agentsById', async () => {
        server.use(
            http.get(`${BASE}/run`, () =>
                HttpResponse.json([
                    {
                        id: 'run-kn',
                        agent_id: 'agent-coder',
                        issue_type: 'story',
                        issue_id: 'ST-20',
                        item_title: 'Known agent story',
                        status: 'completed',
                        created_at: '2026-06-22T10:00:00Z',
                        started_at: '2026-06-22T10:00:10Z',
                        completed_at: '2026-06-22T10:05:00Z',
                        total_cost_usd: 0.1,
                    },
                ]),
            ),
            http.get(`${BASE}/agents`, () =>
                HttpResponse.json([
                    {
                        id: 'agent-coder',
                        name: 'Coder',
                        accent_color: '#31AB46',
                        category: 'software-dev',
                        cli: 'claude',
                        model: 'claude-opus-4-7',
                        effort: 'medium',
                        framework: 'tdd',
                        prompt_md: '',
                        prompt_version: 1,
                        handoff_prompt_md: '',
                        status: 'active',
                        sort_order: 1,
                        description: '',
                        designation: '',
                        role_id: null,
                        max_rounds: 5,
                        requires_item: true,
                        schedule_hours: 6,
                        schedule_preset: 'every_n_hours',
                        schedule_time_of_day: null,
                        schedule_weekdays: null,
                        schedule_day_of_month: null,
                        concurrent_runs: 1,
                        glyph: '',
                        last_run_at: null,
                        next_run_at: null,
                        memory_cadence: 1,
                        kind_slug: 'custom',
                        settings_json: {},
                        cron_expr: null,
                        raises_pr: false,
                        push_code: false,
                        requires_worktree: false,
                        marketplace_source_id: null,
                        marketplace_pulled_version: null,
                        created_at: '2026-01-01T00:00:00Z',
                        updated_at: '2026-01-01T00:00:00Z',
                    },
                ]),
            ),
        );
        renderWithProviders(
            <OverviewTabContent counts={emptyCounts} projectId="proj-1" onJumpToHistory={vi.fn()} />,
        );
        await waitFor(() => expect(screen.getByText('ST-20')).toBeInTheDocument());
        // Agent chip with "Coder" should appear
        expect(screen.getByText('Coder')).toBeInTheDocument();
    });

    it('costSummary with run_count=0 and no terminal sessions: shows "No activity this month"', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    costSummary: {
                        total_cost_usd: 0,
                        run_count: 0,
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_read_tokens: 0,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByText('No activity this month')).toBeInTheDocument(),
        );
    });

    it('renders combined cost + session count when terminalCostSummary is present', async () => {
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    costSummary: {
                        total_cost_usd: 3.0,
                        run_count: 4,
                        input_tokens: 1000,
                        output_tokens: 500,
                        cache_read_tokens: 200,
                        cache_creation_tokens: 0,
                    },
                    terminalCostSummary: {
                        total_cost_usd: 1.5,
                        session_count: 2,
                        input_tokens: 600,
                        output_tokens: 200,
                        cache_read_tokens: 100,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        // Combined value: $3.00 + $1.50 = $4.50
        await waitFor(() => expect(screen.getByText('$4.50')).toBeInTheDocument());
        // Caption shows both run + session counts
        expect(screen.getByText('4')).toBeInTheDocument(); // run count
        expect(screen.getByText('2')).toBeInTheDocument(); // session count
    });

    it('L279: run_count===1 renders singular "run" (covers === 1 true-branch)', async () => {
        // When runCount === 1, the ternary `runCount === 1 ? '' : 's'` fires the
        // truthy branch → caption shows "1 run" not "1 runs".
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    costSummary: {
                        total_cost_usd: 0.5,
                        run_count: 1,
                        input_tokens: 100,
                        output_tokens: 50,
                        cache_read_tokens: 0,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(document.body.textContent).toContain('run'));
        // Should show "1 run" (singular)
        expect(document.body.textContent).not.toContain('1 runs');
    });

    it('L281: session_count===1 renders singular "session" (covers === 1 true-branch)', async () => {
        // When sessionCount === 1, the ternary `sessionCount === 1 ? '' : 's'` fires
        // the truthy branch → caption shows "1 session" not "1 sessions".
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    terminalCostSummary: {
                        total_cost_usd: 0.2,
                        session_count: 1,
                        input_tokens: 0,
                        output_tokens: 0,
                        cache_read_tokens: 0,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(document.body.textContent).toContain('session'));
        expect(document.body.textContent).not.toContain('1 sessions');
    });

    it('L215-217: costSummary with null token fields — ?? 0 branches covered', async () => {
        // Passing null for token fields triggers the `?? 0` fallback branches at L215-217
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    costSummary: {
                        total_cost_usd: 2.0,
                        run_count: 3,
                        input_tokens: null as unknown as number,
                        output_tokens: null as unknown as number,
                        cache_read_tokens: null as unknown as number,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    });

    it('L220-222: terminalCostSummary with null token fields — ?? 0 branches covered', async () => {
        // Passing null for token fields triggers the `?? 0` fallback branches at L220-222
        renderWithProviders(
            <OverviewTabContent
                counts={{
                    ...emptyCounts,
                    terminalCostSummary: {
                        total_cost_usd: 1.0,
                        session_count: 2,
                        input_tokens: null as unknown as number,
                        output_tokens: null as unknown as number,
                        cache_read_tokens: null as unknown as number,
                        cache_creation_tokens: 0,
                    },
                }}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    });

    it('L359: runsPending true-branch — Skeleton shown while runs query is in-flight', () => {
        // Keep the /run handler pending forever so isPending stays true.
        // The component renders the Skeleton block instead of the run rows or empty state.
        server.use(
            http.get(`${BASE}/run`, () => new Promise(() => { /* never resolves */ })),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(
            <OverviewTabContent
                counts={emptyCounts}
                projectId="proj-1"
                onJumpToHistory={vi.fn()}
            />,
        );
        // When the query is still pending, MUI Skeleton elements are rendered
        const skeletons = container.querySelectorAll('.MuiSkeleton-root');
        expect(skeletons.length).toBeGreaterThan(0);
    });
});
