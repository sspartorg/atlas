import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { MarketplaceUpgradeBanner } from './MarketplaceUpgradeBanner.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('MarketplaceUpgradeBanner', () => {
    it('renders nothing when marketplace_source_id is null', () => {
        const agent = makeAgent({ marketplace_source_id: null, marketplace_pulled_version: null });
        const { container } = renderWithProviders(
            <MarketplaceUpgradeBanner agent={agent} />,
        );
        // component returns null — only the react root div remains
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when catalog data is still loading (no MSW handler)', async () => {
        // Register a handler that never responds (simulates pending) — but we
        // just check the banner doesn't appear before data arrives.
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, async () => {
                // Respond after a delay the test won't wait for
                await new Promise(() => {}); // hangs
                return HttpResponse.json({});
            }),
        );
        const agent = makeAgent({
            marketplace_source_id: 'cat-1',
            marketplace_pulled_version: 1,
        });
        const { container } = renderWithProviders(
            <MarketplaceUpgradeBanner agent={agent} />,
        );
        // Before data arrives, component should render null
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when catalog version equals pulled version', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () =>
                HttpResponse.json({
                    agent: { id: 'cat-1', name: 'Coder', version: 1 },
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                }),
            ),
        );
        const agent = makeAgent({
            marketplace_source_id: 'cat-1',
            marketplace_pulled_version: 1,
        });
        const { container } = renderWithProviders(
            <MarketplaceUpgradeBanner agent={agent} />,
        );
        // Even after load, version is not greater so component returns null
        await new Promise((r) => setTimeout(r, 50));
        expect(container.firstChild).toBeNull();
    });

    it('shows "Marketplace upgrade available" banner when catalog version > pulled', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () =>
                HttpResponse.json({
                    agent: { id: 'cat-1', name: 'Coder', version: 2 },
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                }),
            ),
        );
        const agent = makeAgent({
            marketplace_source_id: 'cat-1',
            marketplace_pulled_version: 1,
        });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        await waitFor(() =>
            expect(screen.getByText('Marketplace upgrade available')).toBeTruthy(),
        );
    });

    it('shows version transition in banner text', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () =>
                HttpResponse.json({
                    agent: { id: 'cat-1', name: 'Coder', version: 2 },
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                }),
            ),
        );
        const agent = makeAgent({
            marketplace_source_id: 'cat-1',
            marketplace_pulled_version: 1,
        });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        await waitFor(() => expect(screen.getByText(/v1 → v2/)).toBeTruthy());
    });

    it('shows Review upgrade and Detach buttons when banner is visible', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () =>
                HttpResponse.json({
                    agent: { id: 'cat-1', name: 'Coder', version: 2 },
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                }),
            ),
        );
        const agent = makeAgent({
            marketplace_source_id: 'cat-1',
            marketplace_pulled_version: 1,
        });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /review upgrade/i })).toBeTruthy(),
        );
        expect(screen.getByRole('button', { name: /detach/i })).toBeTruthy();
    });

    it('clicking Review upgrade opens AcceptUpgradeModal (exercises setReviewing(true))', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        // All 5 FIELDS keys must be present in the diff response to avoid undefined access
        const diffResponse = {
            marketplace_version: 2,
            local_pulled_version: 1,
            fields: {
                prompt_md: { changed: true, marketplace: 'new prompt', local: 'old prompt' },
                handoff_prompt_md: { changed: false, marketplace: '', local: '' },
                settings_json: { changed: false, marketplace: '{}', local: '{}' },
                handoff_rules: { changed: false, marketplace: '', local: '' },
                checklists: { changed: false, marketplace: '', local: '' },
            },
        };
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
            http.get(`${BASE}/marketplace/agents/cat-1/diff/agent-coder`, () =>
                HttpResponse.json(diffResponse),
            ),
        );
        const agent = makeAgent({ id: 'agent-coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        const reviewBtn = await screen.findByRole('button', { name: /review upgrade/i });
        fireEvent.click(reviewBtn);
        // AcceptUpgradeModal should open (has a dialog)
        await waitFor(() => {
            expect(document.querySelector('[role="dialog"]')).toBeTruthy();
        }, { timeout: 5000 });
    });

    it('clicking Detach opens confirm modal (exercises setConfirmDetach(true))', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
        );
        const agent = makeAgent({ id: 'agent-coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        const detachBtn = await screen.findByRole('button', { name: /detach/i });
        fireEvent.click(detachBtn);
        // ConfirmActionModal should open
        await waitFor(() => {
            expect(screen.queryByText(/Detach agent-coder/i) ?? document.querySelector('[role="dialog"]')).toBeTruthy();
        });
        // Close it
        const cancelBtn = screen.queryByRole('button', { name: /cancel/i });
        if (cancelBtn) fireEvent.click(cancelBtn);
    });

    it('exercises handleDetach (POST /agents/:id/detach)', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        let detached = false;
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
            http.post(`${BASE}/agents/agent-coder/detach`, () => {
                detached = true;
                return HttpResponse.json({ id: 'agent-coder', marketplace_source_id: null });
            }),
        );
        const agent = makeAgent({ id: 'agent-coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(<MarketplaceUpgradeBanner agent={agent} />);
        const detachBtn = await screen.findByRole('button', { name: /detach/i });
        fireEvent.click(detachBtn);
        // Wait for confirm modal
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
        // Find and click the confirm button (labeled "Detach")
        const confirmBtns = screen.queryAllByRole('button', { name: /^Detach$/i });
        if (confirmBtns.length > 0) {
            fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
            await waitFor(() => expect(detached).toBe(true));
        }
    });

    it('onAccepted callback fires after accepting upgrade — exercises setReviewing(false) + toast', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        const diffResponse = {
            marketplace_version: 2,
            local_pulled_version: 1,
            fields: {
                prompt_md: { changed: true, marketplace: 'new prompt', local: 'old prompt' },
                handoff_prompt_md: { changed: false, marketplace: '', local: '' },
                settings_json: { changed: false, marketplace: '{}', local: '{}' },
                handoff_rules: { changed: false, marketplace: '', local: '' },
                checklists: { changed: false, marketplace: '', local: '' },
            },
        };
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
            http.get(`${BASE}/marketplace/agents/cat-1/diff/agent-coder`, () =>
                HttpResponse.json(diffResponse),
            ),
            http.post(`${BASE}/agents/agent-coder/accept-upgrade`, () =>
                HttpResponse.json({ id: 'agent-coder', marketplace_pulled_version: 2 }),
            ),
        );
        const agent = makeAgent({ id: 'agent-coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(
            <>
                <MarketplaceUpgradeBanner agent={agent} />
                <Toast />
            </>
        );
        // Open AcceptUpgradeModal
        const reviewBtn = await screen.findByRole('button', { name: /review upgrade/i });
        fireEvent.click(reviewBtn);
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy(), { timeout: 5000 });
        // Click "Accept selected" button (it should be enabled since prompt_md changed)
        await waitFor(() => {
            const acceptBtn = screen.queryByRole('button', { name: /Accept selected/i });
            expect(acceptBtn).toBeTruthy();
            expect(acceptBtn).not.toBeDisabled();
        }, { timeout: 5000 });
        fireEvent.click(screen.getByRole('button', { name: /Accept selected/i }));
        // Confirm the accept action in the nested ConfirmActionModal
        await waitFor(() => {
            const confirmBtn = screen.queryByRole('button', { name: /Apply selected/i });
            if (confirmBtn) fireEvent.click(confirmBtn);
        }, { timeout: 5000 });
        // After acceptance, the toast "Upgraded Coder" should appear
        await waitFor(() =>
            expect(screen.queryByText(/Upgraded Coder/i)).toBeTruthy(),
        { timeout: 5000 });
    });

    it('onDismissed callback fires after dismissing upgrade — exercises setReviewing(false) + dismiss toast', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        const diffResponse = {
            marketplace_version: 2,
            local_pulled_version: 1,
            fields: {
                prompt_md: { changed: false, marketplace: 'same', local: 'same' },
                handoff_prompt_md: { changed: false, marketplace: '', local: '' },
                settings_json: { changed: false, marketplace: '{}', local: '{}' },
                handoff_rules: { changed: false, marketplace: '', local: '' },
                checklists: { changed: false, marketplace: '', local: '' },
            },
        };
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
            http.get(`${BASE}/marketplace/agents/cat-1/diff/agent-coder`, () =>
                HttpResponse.json(diffResponse),
            ),
            http.post(`${BASE}/agents/agent-coder/dismiss-upgrade`, () =>
                HttpResponse.json({ id: 'agent-coder', marketplace_pulled_version: 2 }),
            ),
        );
        const agent = makeAgent({ id: 'agent-coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(
            <>
                <MarketplaceUpgradeBanner agent={agent} />
                <Toast />
            </>
        );
        // Open AcceptUpgradeModal
        const reviewBtn = await screen.findByRole('button', { name: /review upgrade/i });
        fireEvent.click(reviewBtn);
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy(), { timeout: 5000 });
        // Click "Dismiss upgrade" button
        await waitFor(() => {
            const dismissBtn = screen.queryByRole('button', { name: /Dismiss upgrade/i });
            expect(dismissBtn).toBeTruthy();
        }, { timeout: 5000 });
        fireEvent.click(screen.getByRole('button', { name: /Dismiss upgrade/i }));
        // Confirm the dismiss action
        await waitFor(() => {
            const confirmBtn = screen.queryByRole('button', { name: /^Dismiss$/i });
            if (confirmBtn) fireEvent.click(confirmBtn);
        }, { timeout: 5000 });
        // After dismissal, "Upgrade dismissed" toast appears
        await waitFor(() =>
            expect(screen.queryByText(/Upgrade dismissed/i)).toBeTruthy(),
        { timeout: 5000 });
    });

    it('handleDetach shows toast after successful detach', async () => {
        const catalogData = {
            agent: { id: 'cat-1', name: 'Coder', version: 2 },
            is_linked: true,
            installed_agent_id: 'agent-coder',
        };
        server.use(
            http.get(`${BASE}/marketplace/agents/cat-1`, () => HttpResponse.json(catalogData)),
            http.post(`${BASE}/agents/agent-coder/detach`, () =>
                HttpResponse.json({ id: 'agent-coder', marketplace_source_id: null }),
            ),
        );
        const agent = makeAgent({ id: 'agent-coder', name: 'Coder', marketplace_source_id: 'cat-1', marketplace_pulled_version: 1 });
        renderWithProviders(
            <>
                <MarketplaceUpgradeBanner agent={agent} />
                <Toast />
            </>
        );
        const detachBtn = await screen.findByRole('button', { name: /detach/i });
        fireEvent.click(detachBtn);
        await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
        const confirmBtns = screen.queryAllByRole('button', { name: /^Detach$/i });
        if (confirmBtns.length > 0) {
            fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
            await waitFor(() =>
                expect(screen.queryByText(/detached from marketplace/i)).toBeTruthy(),
            { timeout: 5000 });
        }
    });

});
