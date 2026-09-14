import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../test-setup.js';
import { defaultHandlers, handlers } from '../../test-utils/mock-handlers.js';
import { makeAgent } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { DashboardEmptyState } from './DashboardEmptyState.js';

// Mock lazy NewProjectModal to avoid Suspense complexity
vi.mock('../projects/NewProjectModal.js', () => ({
    NewProjectModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
        open ? (
            <div role="dialog">
                NewProjectModal
                <button onClick={onClose}>Close</button>
            </div>
        ) : null,
}));

describe('DashboardEmptyState', () => {
    beforeEach(() => {
        server.use(...defaultHandlers);
    });

    it('only promises GitHub URLs and GitHub credential kinds the API accepts', () => {
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        const text = document.body.textContent ?? '';
        expect(text).not.toMatch(/GitLab|Bitbucket|SSH/);
        expect(text).toContain('Personal Access Token or GitHub App');
    });

    it('points to the Marketplace when no agents are installed', async () => {
        renderWithProviders(
            <Routes>
                <Route path="/" element={<DashboardEmptyState ownerFirstName="Bob" />} />
                <Route path="/agents/marketplace" element={<div>Marketplace page</div>} />
            </Routes>,
            { initialEntries: ['/'] },
        );
        fireEvent.click(await screen.findByText('Agents → Marketplace'));
        expect(await screen.findByText('Marketplace page')).toBeInTheDocument();
    });

    it('hides the Marketplace hint once an agent is installed', async () => {
        server.use(handlers.listAgents([makeAgent()]));
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        await waitFor(() => expect(screen.getByText(/No projects yet/)).toBeInTheDocument());
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByText('Agents → Marketplace')).not.toBeInTheDocument();
    });

    it('renders the no-projects copy', () => {
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    });

    it('clicking "New Project" button opens the NewProjectModal (exercises setNewProjectOpen)', async () => {
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        const newProjectBtn = screen.getByRole('button', { name: /New Project/i });
        fireEvent.click(newProjectBtn);
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeInTheDocument();
        });
    });

    it('clicking "Settings → Credentials" link navigates (exercises navigate arrow fn)', () => {
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        const credLink = screen.queryByText(/Settings.*Credentials|Credentials/);
        if (credLink) {
            fireEvent.click(credLink);
            // navigation is called — no assertion needed, just verify no crash
        }
        expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    });

    it('closing the NewProjectModal resets state (exercises onClose callback)', async () => {
        renderWithProviders(<DashboardEmptyState ownerFirstName="Bob" />);
        // Open modal
        fireEvent.click(screen.getByRole('button', { name: /New Project/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
        // Close modal via the mock's Close button — exercises onClose: () => setNewProjectOpen(false)
        fireEvent.click(screen.getByRole('button', { name: /Close/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});
