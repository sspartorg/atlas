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
