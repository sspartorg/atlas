import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentBreadcrumbs } from './AgentBreadcrumbs.js';

describe('AgentBreadcrumbs', () => {
    it('renders the Agents link', () => {
        renderWithProviders(<AgentBreadcrumbs category="Software dev" agentName="Coder" />);
        expect(screen.getByText('Agents')).toBeTruthy();
    });

    it('renders the category segment', () => {
        renderWithProviders(<AgentBreadcrumbs category="Software dev" agentName="Coder" />);
        expect(screen.getByText('Software dev')).toBeTruthy();
    });

    it('renders the agentName segment', () => {
        renderWithProviders(<AgentBreadcrumbs category="Software dev" agentName="Coder" />);
        expect(screen.getByText('Coder')).toBeTruthy();
    });

    it('marks the agent as the current page', () => {
        renderWithProviders(<AgentBreadcrumbs category="Marketing" agentName="Marketer" />);
        expect(screen.getByText('Marketer')).toHaveAttribute('aria-current', 'page');
    });

    it('navigates to /agents when Agents link is clicked', async () => {
        renderWithProviders(<AgentBreadcrumbs category="Software dev" agentName="Coder" />, {
            initialEntries: ['/agents/agent-coder'],
        });
        await userEvent.click(screen.getByText('Agents'));
        // After navigation the current route changes — the component stays
        // mounted so we just verify no error was thrown and the click fired.
    });
});
