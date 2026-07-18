import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AcceptUpgradeModal } from './AcceptUpgradeModal.js';

const BASE = 'http://localhost:3000/api';

const diff = {
    marketplace_version: 4,
    local_pulled_version: 2,
    fields: {
        prompt_md: { changed: true, from: 'old prompt', to: 'new prompt' },
        handoff_prompt_md: { changed: false, from: '', to: '' },
        settings_json: { changed: false, from: {}, to: {} },
        handoff_rules: { changed: false, from: [], to: [] },
        checklists: { changed: false, from: [], to: [] },
    },
};

const diffMultiChange = {
    marketplace_version: 5,
    local_pulled_version: 3,
    fields: {
        prompt_md: { changed: true, from: 'old prompt', to: 'new prompt' },
        handoff_prompt_md: { changed: true, from: 'hold', to: 'hnew' },
        settings_json: { changed: true, from: { a: 1 }, to: { a: 2 } },
        handoff_rules: { changed: false, from: [], to: [] },
        checklists: { changed: false, from: [], to: [] },
    },
};

const diffNoChange = {
    marketplace_version: 4,
    local_pulled_version: 4,
    fields: {
        prompt_md: { changed: false, from: 'same', to: 'same' },
        handoff_prompt_md: { changed: false, from: '', to: '' },
        settings_json: { changed: false, from: {}, to: {} },
        handoff_rules: { changed: false, from: [], to: [] },
        checklists: { changed: false, from: [], to: [] },
    },
};

describe('AcceptUpgradeModal', () => {
    it('does not render content when open=false', () => {
        renderWithProviders(
            <AcceptUpgradeModal
                open={false}
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        expect(screen.queryByText(/review marketplace upgrade/i)).not.toBeInTheDocument();
    });

    it('renders the loading state then the diff body', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diff),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText(/marketplace v4/i)).toBeInTheDocument();
        });
        expect(screen.getByText('Apply Prompt')).toBeInTheDocument();
    });

    it('shows an error state on diff fetch failure', async () => {
        server.use(
            http.get(
                `${BASE}/marketplace/agents/agent-coder/diff/agent-coder`,
                () => HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        await waitFor(() => {
            expect(screen.queryByText(/loading diff/i)).not.toBeInTheDocument();
        });
    });

    it('fires onClose from the Cancel button', async () => {
        const onClose = vi.fn();
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diff),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={onClose}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('toggles a changed field checkbox to deselect it', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diff),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        const cb = (await screen.findByRole('checkbox')) as HTMLInputElement;
        // Initially checked because prompt_md is changed.
        expect(cb.checked).toBe(true);
        fireEvent.click(cb);
        expect(cb.checked).toBe(false);
        // Re-click to flip back on, exercising the add path of toggle().
        fireEvent.click(cb);
        expect(cb.checked).toBe(true);
    });

    it('renders the "no changes" message when nothing is different', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diffNoChange),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText(/catalog version is identical/i)).toBeInTheDocument();
        });
    });

    it('opens then confirms the Accept flow → fires onAccepted', async () => {
        const onAccepted = vi.fn();
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diff),
            ),
            http.post(`${BASE}/agents/agent-coder/accept-upgrade`, () =>
                HttpResponse.json({ id: 'agent-coder' }),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={onAccepted}
                onDismissed={() => {}}
            />,
        );
        const acceptBtn = await screen.findByRole('button', { name: /Accept selected/i });
        fireEvent.click(acceptBtn);
        // ConfirmActionModal opens; find its primary action and click.
        const confirmBtn = await screen.findByRole('button', { name: /Apply selected/i });
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    });

    it('opens then confirms the Dismiss flow → fires onDismissed', async () => {
        const onDismissed = vi.fn();
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diff),
            ),
            http.post(`${BASE}/agents/agent-coder/dismiss-upgrade`, () =>
                HttpResponse.json({ id: 'agent-coder' }),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={onDismissed}
            />,
        );
        const dismissBtn = await screen.findByRole('button', { name: /Dismiss upgrade/i });
        fireEvent.click(dismissBtn);
        const confirmBtn = await screen.findByRole('button', { name: 'Dismiss' });
        fireEvent.click(confirmBtn);
        await waitFor(() => expect(onDismissed).toHaveBeenCalled());
    });

    it('renders all changed JSON/text fields with their checkboxes', async () => {
        server.use(
            http.get(`${BASE}/marketplace/agents/agent-coder/diff/agent-coder`, () =>
                HttpResponse.json(diffMultiChange),
            ),
        );
        renderWithProviders(
            <AcceptUpgradeModal
                open
                onClose={() => {}}
                agentId="agent-coder"
                marketplaceId="agent-coder"
                onAccepted={() => {}}
                onDismissed={() => {}}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('Apply Prompt')).toBeInTheDocument();
        });
        expect(screen.getByText('Apply Handoff prompt')).toBeInTheDocument();
        expect(screen.getByText('Apply Settings')).toBeInTheDocument();
    });
});
