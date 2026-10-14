import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Breadcrumb } from './Breadcrumb.js';

describe('Breadcrumb', () => {
    it('renders parents as links and the leaf as the current page', () => {
        renderWithProviders(
            <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: 'Acme' }]} />
        );
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
        expect(screen.getByText('Acme')).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByRole('link', { name: 'Acme' })).not.toBeInTheDocument();
    });

    it('never links the leaf, even when it has a `to`', () => {
        renderWithProviders(<Breadcrumb items={[{ label: 'Acme', to: '/projects/1' }]} />);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders the trailing control', () => {
        renderWithProviders(
            <Breadcrumb items={[{ label: 'Acme' }]} after={<button type="button">Copy</button>} />
        );
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    });
});
