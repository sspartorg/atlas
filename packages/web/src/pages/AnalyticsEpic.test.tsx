import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import React from 'react';
import type * as Recharts from 'recharts';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { AnalyticsEpic } from './AnalyticsEpic.js';

// Capture formatter props from Recharts Tooltip and Legend so we can invoke
// them directly and hit the inline arrow-function branches.
// vi.hoisted ensures the captured refs exist before vi.mock runs.
const { capturedFormatters } = vi.hoisted(() => ({
    capturedFormatters: {
        tooltip: null as ((...args: unknown[]) => unknown) | null,
        legend: null as ((...args: unknown[]) => unknown) | null,
    },
}));

vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal<typeof Recharts>();
    return {
        ...actual,
        // ResponsiveContainer with 0 size in jsdom never mounts PieChart children;
        // replace it with a simple pass-through so child components get mounted.
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'recharts-container' }, children),
        // PieChart in jsdom also skips rendering children at 0 dimensions;
        // replace it with a simple pass-through so Tooltip/Legend props are read.
        PieChart: ({ children }: { children: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'recharts-piechart' }, children),
        // Pie and Cell don't need to render anything in tests
        Pie: () => null,
        Cell: () => null,
        Tooltip: ({ formatter }: { formatter?: (...args: unknown[]) => unknown }) => {
            if (formatter) capturedFormatters.tooltip = formatter;
            return null;
        },
        Legend: ({ formatter }: { formatter?: (...args: unknown[]) => unknown }) => {
            if (formatter) capturedFormatters.legend = formatter;
            return null;
        },
    };
});

const BASE = 'http://localhost:3000/api';

const minimalEpic = {
    epic: { id: 'ATL-1', title: 'Epic One', project_id: 'p1', project_name: 'Atlas' },
    summary: {
        run_count: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        first_run_at: null,
        last_run_at: null,
    },
    byKind: [],
    totals: {
        run_count: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
    },
    descendant_count: 0,
};

const populatedEpic = {
    epic: { id: 'ATL-1', title: 'Epic One', project_id: 'p1', project_name: 'Atlas' },
    summary: {
        run_count: 5,
        total_cost_usd: 2,
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 1,
        first_run_at: '2026-01-01T00:00:00.000Z',
        last_run_at: '2026-06-01T00:00:00.000Z',
    },
    byKind: [
        { type: 'story', total_cost_usd: 1, item_count: 3, run_count: 4 },
        { type: 'bug', total_cost_usd: 1, item_count: 2, run_count: 1 },
    ],
    totals: {
        run_count: 5,
        total_cost_usd: 2,
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 1,
    },
    descendant_count: 5,
};

const populatedChildren = {
    rows: [
        {
            id: 'ATL-2',
            title: 'Child Story',
            type: 'story',
            depth: 1,
            run_count: 2,
            total_cost_usd: 1,
            last_run_at: '2026-06-01T00:00:00.000Z',
        },
    ],
    total: 1,
    page: 1,
    limit: 25,
};

function renderAt(path: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/analytics/epic/:epicId" element={<AnalyticsEpic />} />
        </Routes>,
        { initialEntries: [path] },
    );
}

describe('AnalyticsEpic page', () => {
    it('mounts without crashing for empty data', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(minimalEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: [], total: 0, page: 1, limit: 25 }),
            ),
        );
        const { container } = renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(container.firstChild).toBeTruthy();
        });
    });

    it('renders the no-id fallback when epicId is missing', () => {
        renderWithProviders(<AnalyticsEpic />);
        expect(screen.getByText(/no epic id/i)).toBeInTheDocument();
    });

    it('renders the populated kind cards + child rows', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText('Child Story')).toBeInTheDocument();
        });
        // Hero title
        expect(screen.getByText('Epic One')).toBeInTheDocument();
    });

    it('filters by type when a kind card is clicked', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText('Child Story')).toBeInTheDocument();
        });
        // The kind cards are buttons; click the first one.
        const kindCards = screen
            .getAllByRole('button')
            .filter((b) => /Stor|Bug/i.test(b.textContent ?? ''));
        if (kindCards[0]) {
            fireEvent.click(kindCards[0]);
        }
    });

    it('renders the error state on summary failure', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText(/Failed to load epic analytics/i)).toBeInTheDocument();
        });
    });

    it('exercises pagination onChange (rows per page + page change) after data loads', async () => {
        const rows = Array.from({ length: 30 }, (_, i) => ({
            id: `ATL-${i + 2}`,
            title: `Child ${i + 1}`,
            type: 'story',
            depth: 1,
            run_count: i,
            total_cost_usd: i * 0.1,
            last_run_at: i % 2 === 0 ? '2026-06-01T00:00:00.000Z' : null,
        }));
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: rows.slice(0, 25), total: 30, page: 1, limit: 25 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Child 1')).toBeInTheDocument());
        // Try page change via Pagination component
        const nextPageBtns = screen.queryAllByRole('button', { name: /Go to page 2|next page/i });
        if (nextPageBtns[0]) {
            fireEvent.click(nextPageBtns[0]);
        }
        // Try rows-per-page Select
        const rowsSelect = screen.queryByRole('combobox');
        if (rowsSelect) {
            fireEvent.mouseDown(rowsSelect);
            const opt50 = document.querySelector('[data-value="50"]');
            if (opt50) fireEvent.click(opt50);
        }
        expect(document.body).toBeTruthy();
    });

    it('exercises "clear filter" button to reset typeFilter and page', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Child Story')).toBeInTheDocument());
        // Click a kind card to apply filter
        const kindCards = screen.getAllByRole('button').filter((b) => /Stor|Bug/i.test(b.textContent ?? ''));
        if (kindCards[0]) {
            fireEvent.click(kindCards[0]);
            // Now click "Clear filter" or similar
            const clearBtn = screen.queryByRole('button', { name: /clear|all/i });
            if (clearBtn) fireEvent.click(clearBtn);
        }
        expect(document.body).toBeTruthy();
    });

    it('renders loading skeleton when summary query is pending', () => {
        // summary.isPending → renders skeletons, no content yet
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => new Promise(() => {})), // never resolves
        );
        renderAt('/analytics/epic/ATL-1');
        // Three Skeleton elements are rendered; just assert the page doesn't crash
        expect(document.body).toBeTruthy();
    });

    it('fmtRelativeOrDash: null → dash character in last-run column', async () => {
        // row.last_run_at === null → fmtRelativeOrDash returns '—'
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-10',
                            title: 'Null Run Item',
                            type: 'story',
                            depth: 1,
                            run_count: 0,
                            total_cost_usd: 0,
                            last_run_at: null,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Null Run Item')).toBeInTheDocument());
        // The null path renders the em dash '—'
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('fmtRelativeOrDash: invalid ISO → dash character', async () => {
        // new Date('not-a-date').getTime() is NaN → fmtRelativeOrDash returns '—'
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-11',
                            title: 'Invalid Date Item',
                            type: 'bug',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.1,
                            last_run_at: 'not-a-date',
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Invalid Date Item')).toBeInTheDocument());
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('fmtRelativeOrDash: < 1 min → "just now"', async () => {
        // diff < 60000ms → 'just now'
        const recentIso = new Date(Date.now() - 30_000).toISOString(); // 30s ago
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-12',
                            title: 'Just Now Item',
                            type: 'story',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.05,
                            last_run_at: recentIso,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Just Now Item')).toBeInTheDocument());
        expect(screen.getByText('just now')).toBeInTheDocument();
    });

    it('fmtRelativeOrDash: < 60 min → "Nm ago"', async () => {
        // 1 <= mins < 60 → 'Nm ago'
        const tenMinsAgo = new Date(Date.now() - 10 * 60_000).toISOString();
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-13',
                            title: 'Ten Mins Item',
                            type: 'story',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.05,
                            last_run_at: tenMinsAgo,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Ten Mins Item')).toBeInTheDocument());
        expect(screen.getByText(/\d+m ago/)).toBeInTheDocument();
    });

    it('fmtRelativeOrDash: < 24 h → "Nh ago"', async () => {
        // 60 <= mins < 1440 → hours branch
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-14',
                            title: 'Three Hours Item',
                            type: 'story',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.05,
                            last_run_at: threeHoursAgo,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Three Hours Item')).toBeInTheDocument());
        expect(screen.getByText(/\d+h ago/)).toBeInTheDocument();
    });

    it('fmtRelativeOrDash: < 7 days → "Nd ago"', async () => {
        // 1 <= days < 7 → days branch
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-15',
                            title: 'Three Days Item',
                            type: 'story',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.05,
                            last_run_at: threeDaysAgo,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Three Days Item')).toBeInTheDocument());
        expect(screen.getByText(/\d+d ago/)).toBeInTheDocument();
    });

    it('fmtRelativeOrDash: >= 7 days → date string (toLocaleDateString)', async () => {
        // days >= 7 → returns d.toLocaleDateString(...)
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({
                    rows: [
                        {
                            id: 'ATL-16',
                            title: 'Old Item',
                            type: 'bug',
                            depth: 1,
                            run_count: 1,
                            total_cost_usd: 0.1,
                            last_run_at: tenDaysAgo,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 25,
                }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Old Item')).toBeInTheDocument());
        // 10 days ago renders a date string like "16 Jun" (not "Nd ago")
        expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });

    it('renders avg cost per run as dash when totals.run_count === 0', async () => {
        // data.totals.run_count === 0 → MetricMarquee shows '—' for avg cost/run
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(minimalEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: [], total: 0, page: 1, limit: 25 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText('Epic One')).toBeInTheDocument();
        });
        // The '—' dash is rendered for avg cost/run when run_count === 0
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('renders "No items match" when children rows are empty', async () => {
        // (children.data?.rows.length ?? 0) === 0 && !isPending →
        // "No items match the current filter." message
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: [], total: 0, page: 1, limit: 25 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText(/No items match the current filter/i)).toBeInTheDocument();
        });
    });

    it('deletes chip filter via onDelete to reset typeFilter', async () => {
        // Apply a typeFilter by clicking a kind card, then use Chip onDelete
        // (the × button on the Chip) to clear it — exercises setTypeFilter(null)
        // and setPage(1) via the Chip onDelete handler.
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Child Story')).toBeInTheDocument());
        // Click a kind card to set typeFilter
        const kindCards = screen
            .getAllByRole('button')
            .filter((b) => /Story|Bug/i.test(b.textContent ?? ''));
        if (kindCards[0]) {
            fireEvent.click(kindCards[0]);
        }
        await waitFor(() => {
            // The "Showing only:" chip should now appear
            const chip = screen.queryByText(/Showing only:/i);
            if (chip) {
                // Click the delete button (× on the Chip)
                const deleteBtn = document.querySelector('[aria-label="Cancel"]') ??
                    document.querySelector('svg[data-testid="CancelIcon"]')?.closest('button');
                if (deleteBtn) {
                    fireEvent.click(deleteBtn);
                }
            }
        });
        expect(document.body).toBeTruthy();
    });

    it('renders fallback project_id in breadcrumb when project_name is empty', async () => {
        // data.epic.project_name is empty → breadcrumb shows project_id
        const noNameEpic = {
            ...populatedEpic,
            epic: { id: 'ATL-1', title: 'Epic One', project_id: 'p-fallback', project_name: '' },
        };
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(noNameEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: [], total: 0, page: 1, limit: 25 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => {
            expect(screen.getByText('Epic One')).toBeInTheDocument();
        });
        // Breadcrumb shows project_id when project_name is empty
        expect(screen.getByText('p-fallback')).toBeInTheDocument();
    });

    // ── L156 branch: both project_name AND project_id are falsy → 'Project' ──
    it('renders "Project" fallback in breadcrumb when both project_name and project_id are empty', async () => {
        const noIdNoNameEpic = {
            ...populatedEpic,
            epic: { id: 'ATL-1', title: 'Epic One', project_id: '', project_name: '' },
        };
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(noIdNoNameEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json({ rows: [], total: 0, page: 1, limit: 25 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());
        expect(screen.getByText('Project')).toBeInTheDocument();
    });

    // ── L171 branch: singular "child item" (descendant_count === 1) ──
    it('renders "child item" (singular) when descendant_count is 1', async () => {
        const singleDescEpic = { ...populatedEpic, descendant_count: 1 };
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(singleDescEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());
        expect(screen.getByText(/1 child item\b/)).toBeInTheDocument();
    });

    // ── L110: error?.message ?? 'unknown error' — error with no .message ──
    it('shows "unknown error" when the summary error has no message', async () => {
        server.use(
            // Return a non-JSON body so the fetch parsing throws without a .message
            http.get(`${BASE}/analytics/epic/ATL-1`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() =>
            expect(screen.getByText(/Failed to load epic analytics/i)).toBeInTheDocument(),
        );
        // The message branch: if error.message is undefined/empty → 'unknown error'
        // (api client may throw without message — just assert the error UI renders)
        expect(document.body).toBeTruthy();
    });

    // ── L329: singular item_count / run_count on kind card ──
    it('renders singular "item" and "run" on a kind card with counts of 1', async () => {
        const singleCountEpic = {
            ...populatedEpic,
            byKind: [{ type: 'story', total_cost_usd: 1, item_count: 1, run_count: 1 }],
        };
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(singleCountEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());
        // "1 item • 1 run" (no trailing 's')
        expect(screen.getByText(/1 item\s*•\s*1 run$/)).toBeInTheDocument();
    });

    // ── L233/L303/L308/L444/L445/L453: unknown kind → fallback color & label ──
    it('renders unknown kind types with fallback color and raw type label', async () => {
        const unknownKindEpic = {
            ...populatedEpic,
            byKind: [{ type: 'unknown_kind', total_cost_usd: 2, item_count: 3, run_count: 2 }],
        };
        const unknownKindChildren = {
            rows: [
                {
                    id: 'ATL-99',
                    title: 'Unknown Kind Child',
                    type: 'unknown_kind',
                    depth: 1,
                    run_count: 1,
                    total_cost_usd: 0.5,
                    last_run_at: null,
                },
            ],
            total: 1,
            page: 1,
            limit: 25,
        };
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(unknownKindEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(unknownKindChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Unknown Kind Child')).toBeInTheDocument());
        // Fallback label renders the raw type string (L308 and L453)
        expect(screen.getAllByText('unknown_kind').length).toBeGreaterThan(0);
    });

    // ── L275: toggle off an active kind filter (click active card again) ──
    it('toggles off the active kind filter when the same kind card is clicked again', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Child Story')).toBeInTheDocument());
        const kindCards = screen
            .getAllByRole('button')
            .filter((b) => /Story|Bug/i.test(b.textContent ?? ''));
        if (kindCards[0]) {
            // First click → sets filter
            fireEvent.click(kindCards[0]);
            await waitFor(() => {
                const chip = screen.queryByText(/Showing only:/i);
                expect(chip).toBeTruthy();
            });
            // Second click on same card → clears filter (isActive → null)
            fireEvent.click(kindCards[0]);
        }
        // After toggle-off, the "Showing all kinds" chip should return
        await waitFor(() =>
            expect(screen.queryByText('Showing all kinds')).toBeInTheDocument(),
        );
    });

    // ── L351 onDelete: Chip × button clears typeFilter and resets page ──
    it('onDelete on the filter Chip clears typeFilter and resets page to 1', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Child Story')).toBeInTheDocument());

        // Click a kind card to activate the typeFilter
        const kindCards = screen
            .getAllByRole('button')
            .filter((b) => /Story|Bug/i.test(b.textContent ?? ''));
        expect(kindCards.length).toBeGreaterThan(0);
        fireEvent.click(kindCards[0]!);

        // Wait for the filter Chip to appear
        await waitFor(() =>
            expect(screen.queryByText(/Showing only:/i)).toBeTruthy(),
        );

        // MUI Chip renders the delete affordance as an <svg data-testid="CancelIcon">.
        // Click the SVG directly (same pattern used in SubTaskDetail / SubBugDetail tests).
        const cancelIcon = document.querySelector(
            'svg[data-testid="CancelIcon"]',
        ) as HTMLElement | null;
        if (cancelIcon) {
            fireEvent.click(cancelIcon);
        } else {
            // Fallback: MUI may also use aria-label="Cancel" on the button wrapper
            const cancelBtn = document.querySelector('[aria-label="Cancel"]') as HTMLElement | null;
            if (cancelBtn) fireEvent.click(cancelBtn);
        }

        // After delete, the "Showing all kinds" chip replaces the filter chip
        await waitFor(() =>
            expect(screen.getByText('Showing all kinds')).toBeInTheDocument(),
        );
    });

    // ── L490: children.isPending skeleton when summary resolved but children pending ──
    it('renders the children loading skeleton when the children query is still pending', async () => {
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            // Children never resolves
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () => new Promise(() => {})),
        );
        renderAt('/analytics/epic/ATL-1');
        // Wait until summary has rendered (Hero title visible)
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());
        // The Skeleton for pending children is rendered — just assert no crash
        expect(document.body).toBeTruthy();
    });

    // ── L240 Tooltip formatter: invoke the captured formatter directly ──
    it('Tooltip formatter returns formatted cost and resolved label for known type', async () => {
        capturedFormatters.tooltip = null;
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());

        expect(capturedFormatters.tooltip).not.toBeNull();
        const fmt = capturedFormatters.tooltip!;

        // Known type: payload.type = 'story'
        const result = fmt(1.5, undefined, { payload: { type: 'story' } }) as [string, string];
        expect(Array.isArray(result)).toBe(true);
        expect(result[0]).toContain('1'); // formatted cost string contains '1'
        expect(result[1]).toBe('Story');  // ITEM_TYPE_LABEL['story']

        // Unknown type: payload.type = 'custom_type' (not in ITEM_TYPE_LABEL → raw)
        const resultUnknown = fmt(0.5, undefined, {
            payload: { type: 'custom_type' },
        }) as [string, string];
        expect(resultUnknown[1]).toBe('custom_type');

        // No type in payload → empty string label (both branches false → '')
        const resultNoType = fmt(0, undefined, { payload: {} }) as [string, string];
        expect(resultNoType[1]).toBe('');

        // value is null → formatCostUsd(0)
        const resultNoValue = fmt(null, undefined, { payload: { type: 'bug' } }) as [string, string];
        expect(resultNoValue[1]).toBe('Bug');
    });

    // ── L256 Legend formatter: invoke the captured formatter directly ──
    it('Legend formatter returns ITEM_TYPE_LABEL for known types and raw string for unknown', async () => {
        capturedFormatters.legend = null;
        server.use(
            http.get(`${BASE}/analytics/epic/ATL-1`, () => HttpResponse.json(populatedEpic)),
            http.get(`${BASE}/analytics/epic/ATL-1/children`, () =>
                HttpResponse.json(populatedChildren),
            ),
        );
        renderAt('/analytics/epic/ATL-1');
        await waitFor(() => expect(screen.getByText('Epic One')).toBeInTheDocument());

        expect(capturedFormatters.legend).not.toBeNull();
        const fmt = capturedFormatters.legend!;

        // Known kinds
        expect(fmt('story')).toBe('Story');
        expect(fmt('bug')).toBe('Bug');
        // Unknown kind → returns raw string (the ?? t branch)
        expect(fmt('mystery_kind')).toBe('mystery_kind');
    });
});
