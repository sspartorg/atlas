import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type * as RouterDom from 'react-router-dom';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Breadcrumb } from './Breadcrumb.js';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof RouterDom>('react-router-dom');
    return { ...actual, useNavigate: () => navigateSpy };
});

describe('Breadcrumb', () => {
    it('renders the leaf text as the last segment', () => {
        renderWithProviders(
            <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: 'Acme' }]} />,
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Projects')).toBeInTheDocument();
    });

    it('navigates when a non-last clickable segment is clicked', () => {
        navigateSpy.mockClear();
        renderWithProviders(
            <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: 'Acme' }]} />,
        );
        fireEvent.click(screen.getByText('Projects'));
        expect(navigateSpy).toHaveBeenCalledWith('/projects');
    });

    it('does NOT navigate when clicking the leaf segment', () => {
        navigateSpy.mockClear();
        renderWithProviders(
            <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: 'Acme' }]} />,
        );
        fireEvent.click(screen.getByText('Acme'));
        expect(navigateSpy).not.toHaveBeenCalled();
    });
});
