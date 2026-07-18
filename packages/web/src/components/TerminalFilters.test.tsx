import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { TerminalFilters } from './TerminalFilters.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeProject } from '../test-utils/factories.js';

const defaultCounts = { all: 5, active: 2, paused: 1, closed: 1, errored: 1 };

function renderFilters(overrides: Partial<Parameters<typeof TerminalFilters>[0]> = {}) {
    const props = {
        status: 'all' as const,
        cli: 'all' as const,
        projectId: 'all' as const,
        search: '',
        counts: defaultCounts,
        projects: [makeProject({ id: 'p1', name: 'Alpha' }), makeProject({ id: 'p2', name: 'Beta' })],
        onStatusChange: vi.fn(),
        onCliChange: vi.fn(),
        onProjectChange: vi.fn(),
        onSearchChange: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<TerminalFilters {...props} />);
    return props;
}

describe('TerminalFilters', () => {
    it('renders all status filter pills', () => {
        renderFilters();
        // FilterPill renders buttons or clickable elements for each status
        expect(screen.getByText('All')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Paused')).toBeInTheDocument();
        expect(screen.getByText('Closed')).toBeInTheDocument();
        expect(screen.getByText('Errored')).toBeInTheDocument();
    });

    it('calls onStatusChange when a status pill is clicked', () => {
        const props = renderFilters();
        fireEvent.click(screen.getByText('Active'));
        expect(props.onStatusChange).toHaveBeenCalledWith('active');
    });

    it('calls onStatusChange when Paused pill is clicked', () => {
        const props = renderFilters();
        fireEvent.click(screen.getByText('Paused'));
        expect(props.onStatusChange).toHaveBeenCalledWith('paused');
    });

    it('calls onStatusChange when Closed pill is clicked', () => {
        const props = renderFilters();
        fireEvent.click(screen.getByText('Closed'));
        expect(props.onStatusChange).toHaveBeenCalledWith('closed');
    });

    it('calls onStatusChange when Errored pill is clicked', () => {
        const props = renderFilters();
        fireEvent.click(screen.getByText('Errored'));
        expect(props.onStatusChange).toHaveBeenCalledWith('errored');
    });

    it('calls onStatusChange when All pill is clicked', () => {
        const props = renderFilters({ status: 'active' });
        fireEvent.click(screen.getByText('All'));
        expect(props.onStatusChange).toHaveBeenCalledWith('all');
    });

    it('shows count badges on status pills', () => {
        renderFilters();
        // counts are displayed in the pills
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders CLI dropdown with options', () => {
        renderFilters();
        // The DropdownChip renders "CLI:" as a label span
        expect(screen.getByText(/^CLI:?$/)).toBeInTheDocument();
    });

    it('renders Project dropdown', () => {
        renderFilters();
        expect(screen.getByText(/^Project:?$/)).toBeInTheDocument();
    });

    it('renders search text input', () => {
        renderFilters();
        // SearchPillTextField renders a text field
        const inputs = screen.getAllByRole('textbox');
        expect(inputs.length).toBeGreaterThan(0);
    });

    it('calls onSearchChange when search input changes', () => {
        const props = renderFilters();
        const inputs = screen.getAllByRole('textbox');
        fireEvent.change(inputs[0]!, { target: { value: 'my-session' } });
        expect(props.onSearchChange).toHaveBeenCalledWith('my-session');
    });

    it('renders with active status selected (exercises accent.fg icon color branch)', () => {
        // When status === 'active', the icon uses accent.fg (ATLAS_PALETTE.white)
        renderFilters({ status: 'active' });
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders with paused status selected (exercises accent.fg icon color branch)', () => {
        renderFilters({ status: 'paused' });
        expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    it('renders with errored status selected (exercises accent.fg icon color branch)', () => {
        renderFilters({ status: 'errored' });
        expect(screen.getByText('Errored')).toBeInTheDocument();
    });

    it('renders with closed status selected (exercises accent.fg icon color branch)', () => {
        renderFilters({ status: 'closed' });
        expect(screen.getByText('Closed')).toBeInTheDocument();
    });

    it('renders with selected CLI filter (exercises project options rendering)', () => {
        renderFilters({ cli: 'claude' });
        expect(screen.getByText(/^CLI:?$/)).toBeInTheDocument();
    });

    it('renders with a specific project selected', () => {
        renderFilters({ projectId: 'p1' });
        expect(screen.getByText(/^Project:?$/)).toBeInTheDocument();
    });

    it('renders with no projects (empty projects array)', () => {
        renderFilters({ projects: [] });
        expect(screen.getByText(/^Project:?$/)).toBeInTheDocument();
    });
});
