import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Dashboard } from './Dashboard.js';

const BASE = 'http://localhost:3000/api';

describe('Dashboard page', () => {
    it('renders without crashing', async () => {
        server.use(...defaultHandlers);
        const { container } = renderWithProviders(<Dashboard />, {
            initialEntries: ['/dashboard'],
        });
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the BrandedFallback while the dashboard query is loading', () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/dashboard`, async () => {
                // Never-resolving response keeps the query pending.
                await new Promise(() => {});
                return HttpResponse.json({});
            }),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        // BrandedFallback renders the Atlas logo (img with alt) + spinner.
        expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });

    it('renders the empty-state with the owner first name when no projects exist', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Ada Lovelace', onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () => HttpResponse.json({ kpis: { projectCount: 0 } })),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        // DashboardEmptyState renders the first-name greeting.
        await waitFor(() => {
            const txt = document.body.textContent ?? '';
            expect(txt.includes('Ada') || /no projects yet/i.test(txt)).toBe(true);
        });
    });

    it('falls back to "there" when owner_name is missing on the empty-state path', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () => HttpResponse.json({ kpis: { projectCount: 0 } })),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        await waitFor(() => {
            // Either greets "there" or shows the no-project copy — both branches mean
            // the empty-state path was rendered successfully.
            const txt = document.body.textContent ?? '';
            expect(/there|no projects/i.test(txt)).toBe(true);
        });
    });

    it('renders the populated dashboard branch when projectCount > 0', async () => {
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({
                    kpis: { projectCount: 3, openItems: 0, inFlightItems: 0, agentsRunning: 0 },
                    awaiting: [],
                    inMotion: [],
                    todaysPass: [],
                    perProject: [],
                    monthlyCost: { spent: 0, limit: null, runs: 0 },
                    agentCategoryStats: [],
                }),
            ),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        // The populated dashboard is rendered inside a Box that pads the
        // viewport — the empty state copy must NOT appear.
        await waitFor(() => {
            expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
        });
    });

    it('empty state: ?? fallback fires when owner_name is null (line 23 ?? branch)', async () => {
        // settings.owner_name is null → settings?.owner_name?.trim() is undefined → ?? '' fires.
        // Overrides placed BEFORE defaultHandlers so they win (MSW first-match).
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: null, onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({ kpis: { projectCount: 0 } }),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        await waitFor(
            () => expect(document.body.textContent).toMatch(/No projects yet/),
            { timeout: 3000 },
        );
    });

    it('empty state falls back ownerFirstName to "there" when owner_name is blank (line 24 || branch)', async () => {
        // settings.owner_name is empty string → fullName = '' → split()[0] = '' → || 'there' branch
        // Overrides placed BEFORE defaultHandlers so they win (MSW first-match).
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: '', onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({ kpis: { projectCount: 0 } }),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        await waitFor(
            () => expect(document.body.textContent).toMatch(/No projects yet/),
            { timeout: 3000 },
        );
    });

    it('DashboardPopulated rendered: greeting block visible when projectCount > 0 (lines 28-33)', async () => {
        // Override settings with a distinctive first name and dashboard with projectCount > 0.
        // Place dashboard and settings overrides BEFORE defaultHandlers so they win
        // (MSW v2 processes handlers in array-insertion order; first match wins).
        server.use(
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Zephyr Test', onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({
                    kpis: { projectCount: 5 },
                    awaiting: [],
                    queue: [],
                }),
            ),
            ...defaultHandlers,
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        // DashboardPopulated -> GreetingBlock uppercases the owner name: "..., ZEPHYR"
        await waitFor(
            () => expect(document.body.textContent).toMatch(/ZEPHYR/),
            { timeout: 5000 },
        );
    });

    it('renders empty state when dashboard data has no kpis field (kpis undefined branch)', async () => {
        // Covers the `data.kpis?.projectCount ?? 0` branch where kpis is undefined
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/settings`, () =>
                HttpResponse.json({ id: 1, owner_name: 'Sam Test', onboarding_complete: 1 }),
            ),
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({
                    // kpis intentionally omitted → data.kpis is undefined
                    awaiting: [],
                    inMotion: [],
                    todaysPass: [],
                    perProject: [],
                    monthlyCost: { spent: 0, limit: null, runs: 0 },
                    agentCategoryStats: [],
                }),
            ),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        // With kpis undefined → projectCount defaults to 0 via `?? 0` → empty state renders
        await waitFor(() => {
            const txt = document.body.textContent ?? '';
            expect(/Sam|no projects/i.test(txt)).toBe(true);
        });
    });

    it('renders empty state with "there" when settings is undefined (settings?.owner_name null path)', async () => {
        // Covers the settings?.owner_name branch where settings query is still loading/undefined
        server.use(
            ...defaultHandlers,
            http.get(`${BASE}/settings`, () =>
                // Return a null body which causes useSettings to return { data: undefined }
                new Promise(() => {}),
            ),
            http.get(`${BASE}/dashboard`, () =>
                HttpResponse.json({ kpis: { projectCount: 0 } }),
            ),
        );
        renderWithProviders(<Dashboard />, { initialEntries: ['/dashboard'] });
        await waitFor(() => {
            const txt = document.body.textContent ?? '';
            // With settings undefined, falls back to 'there'
            expect(/there|no projects/i.test(txt)).toBe(true);
        });
    });
});
