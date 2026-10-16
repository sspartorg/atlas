import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { PageHeader } from './PageHeader.js';

describe('PageHeader', () => {
    it('renders the title as the page h1 with its subtitle and actions', () => {
        renderWithProviders(
            <PageHeader
                icon="folder"
                title="Projects"
                subtitle="3 projects"
                actions={<button type="button">New project</button>}
            />
        );
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projects');
        expect(screen.getByText('3 projects')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
    });

    it('keeps the actions in the title row and the subtitle outside it', () => {
        renderWithProviders(
            <PageHeader
                title="Reminders"
                subtitle="A long line about schedules"
                actions={<button type="button">Refresh</button>}
            />
        );
        const row = screen.getByTestId('page-header-title-row');
        expect(row).toContainElement(screen.getByRole('heading', { level: 1 }));
        expect(row).toContainElement(screen.getByRole('button', { name: 'Refresh' }));
        expect(row).not.toContainElement(screen.getByText('A long line about schedules'));
    });

    it('shows a breadcrumb only when given one', () => {
        const { unmount } = renderWithProviders(<PageHeader title="Projects" />);
        expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
        unmount();
        renderWithProviders(
            <PageHeader
                title="Credentials"
                breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Credentials' }]}
            />
        );
        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });
});
