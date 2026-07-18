import { describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Marketplace } from './Marketplace.js';
import type { IMarketplaceAgentSummary } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';

function makeSummary(overrides: Partial<IMarketplaceAgentSummary> = {}): IMarketplaceAgentSummary {
    return {
        id: 'agent-coder',
        name: 'Coder',
        category: 'software-dev',
        kind_slug: 'custom',
        summary: 'A coding agent',
        accent_color: '#0A0A0A',
        glyph: 'code',
        version: 3,
        is_installed: false,
        is_linked: false,
        installed_agent_id: null,
        installed_version: null,
        upgrade_available: false,
        ...overrides,
    };
}

describe('Marketplace page', () => {
    it('renders the heading and empty count when no agents', async () => {
        server.use(http.get(`${BASE}/marketplace/agents`, () => HttpResponse.json([])));
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText(/no catalog agents/i)).toBeInTheDocument();
        });
    });

    it('renders agent cards from the catalog', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([makeSummary(), makeSummary({ id: 'agent-reviewer', name: 'Reviewer' })]),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText('Coder')).toBeInTheDocument();
            expect(screen.getByText('Reviewer')).toBeInTheDocument();
        });
    });

    it('reports upgrade count when some agents have upgrade_available', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({
                        is_installed: true,
                        installed_agent_id: 'agent-coder',
                        installed_version: 2,
                        upgrade_available: true,
                    }),
                ]),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText(/1 upgrade ready/)).toBeInTheDocument();
        });
    });

    it('filters by category chip', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, ({ request }) => {
                const url = new URL(request.url);
                const cat = url.searchParams.get('category');
                if (cat === 'marketing') {
                    return HttpResponse.json([
                        makeSummary({
                            id: 'agent-marketer',
                            name: 'Marketer',
                            category: 'marketing',
                        }),
                    ]);
                }
                return HttpResponse.json([makeSummary()]);
            }),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText('Coder')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Marketing'));
        await waitFor(() => {
            expect(screen.getByText('Marketer')).toBeInTheDocument();
        });
    });

    it('bulk-installs the selected agents and navigates to the Agents page', async () => {
        const installed: string[] = [];
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({ id: 'agent-coder', name: 'Coder' }),
                    makeSummary({ id: 'agent-architect', name: 'Architect' }),
                ]),
            ),
            http.post(`${BASE}/marketplace/agents/:id/install`, ({ params }) => {
                installed.push(params['id'] as string);
                return HttpResponse.json({ id: params['id'] }, { status: 201 });
            }),
        );

        renderWithProviders(
            <Routes>
                <Route path="/" element={<Marketplace />} />
                <Route path="/agents" element={<div>Agents Page</div>} />
            </Routes>,
            { initialEntries: ['/'] },
        );
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);
        fireEvent.click(checkboxes[0]!);
        fireEvent.click(checkboxes[1]!);

        expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /add selected/i }));

        await waitFor(() => expect(screen.getByText('Agents Page')).toBeInTheDocument());
        expect([...installed].sort()).toEqual(['agent-architect', 'agent-coder']);
    });

    it('Select all picks every installable agent and Clear empties the selection', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({ id: 'agent-coder', name: 'Coder' }),
                    makeSummary({ id: 'agent-architect', name: 'Architect' }),
                    makeSummary({
                        id: 'agent-qa',
                        name: 'QA',
                        is_installed: true,
                        installed_agent_id: 'agent-qa',
                        installed_version: 3,
                    }),
                ]),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());

        // Installed QA has no checkbox → only the two installable cards do.
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);

        // Reveal the bar by picking one, then Select all grabs the rest.
        fireEvent.click(checkboxes[0]!);
        fireEvent.click(screen.getByRole('button', { name: /select all/i }));
        expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /clear/i }));
        await waitFor(() =>
            expect(screen.queryByText(/selected/i)).not.toBeInTheDocument(),
        );
    });

    it('renders error state when marketplace fetch fails', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText(/Failed to load marketplace/i)).toBeInTheDocument();
        });
    });

    it('renders no-filter-match message when data is empty after filter', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, ({ request }) => {
                const url = new URL(request.url);
                const cat = url.searchParams.get('category');
                if (cat === 'content') return HttpResponse.json([]);
                return HttpResponse.json([makeSummary()]);
            }),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Content'));
        await waitFor(() => {
            expect(screen.getByText(/No marketplace agents match/i)).toBeInTheDocument();
        });
    });

    it('renders singular "1 upgrade ready" in subtitle when upgradeCount === 1', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({
                        is_installed: true,
                        installed_agent_id: 'agent-coder',
                        installed_version: 1,
                        upgrade_available: true,
                    }),
                    makeSummary({ id: 'agent-b', name: 'Agent B', is_installed: false }),
                ]),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText(/1 upgrade ready/)).toBeInTheDocument();
        });
    });

    it('shows plural upgrades subtitle when upgradeCount > 1', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({
                        id: 'agent-coder',
                        is_installed: true,
                        installed_agent_id: 'agent-coder',
                        installed_version: 1,
                        upgrade_available: true,
                    }),
                    makeSummary({
                        id: 'agent-b',
                        name: 'Agent B',
                        is_installed: true,
                        installed_agent_id: 'agent-b',
                        installed_version: 1,
                        upgrade_available: true,
                    }),
                ]),
            ),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => {
            expect(screen.getByText(/2 upgrades ready/)).toBeInTheDocument();
        });
    });

    it('addSelected — all installs fail: keeps failed ids selected (no navigate)', async () => {
        let installAttempted = false;
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({ id: 'agent-coder', name: 'Coder' }),
                ]),
            ),
            http.post(`${BASE}/marketplace/agents/:id/install`, () => {
                installAttempted = true;
                return HttpResponse.json({ error: 'conflict', kind: 'internal_error' }, { status: 409 });
            }),
        );
        renderWithProviders(
            <Routes>
                <Route path="/" element={<Marketplace />} />
                <Route path="/agents" element={<div>Agents Page</div>} />
            </Routes>,
            { initialEntries: ['/'] },
        );
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]!);
        expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /add selected/i }));

        // After all-fail path, page stays on Marketplace (no navigate to /agents)
        await waitFor(() => expect(installAttempted).toBe(true));
        await new Promise((r) => setTimeout(r, 200));
        expect(screen.queryByText('Agents Page')).not.toBeInTheDocument();
    });

    it('addSelected — partial failure: shows failNote in toast and navigates to agents', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () =>
                HttpResponse.json([
                    makeSummary({ id: 'agent-good', name: 'Good Agent' }),
                    makeSummary({ id: 'agent-bad', name: 'Bad Agent' }),
                ]),
            ),
            http.post(`${BASE}/marketplace/agents/agent-good/install`, () =>
                HttpResponse.json({ id: 'agent-good' }, { status: 201 }),
            ),
            http.post(`${BASE}/marketplace/agents/agent-bad/install`, () =>
                HttpResponse.json({ message: 'conflict' }, { status: 409 }),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/" element={<Marketplace />} />
                <Route path="/agents" element={<div>Agents Page</div>} />
            </Routes>,
            { initialEntries: ['/'] },
        );
        await waitFor(() => expect(screen.getByText('Good Agent')).toBeInTheDocument());

        const checkboxes = screen.getAllByRole('checkbox');
        checkboxes.forEach((cb) => fireEvent.click(cb));
        fireEvent.click(screen.getByRole('button', { name: /add selected/i }));

        await waitFor(() => expect(screen.getByText('Agents Page')).toBeInTheDocument());
    });

    it('search text field onChange updates the query (setQuery)', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents`, () => HttpResponse.json([makeSummary()])),
        );
        renderWithProviders(<Marketplace />);
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());
        const searchInput = screen.getByPlaceholderText(/search marketplace/i);
        fireEvent.change(searchInput, { target: { value: 'test query' } });
        await new Promise((r) => setTimeout(r, 50));
    });
});
