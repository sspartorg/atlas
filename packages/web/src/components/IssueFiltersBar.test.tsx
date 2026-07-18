import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeProject } from '../test-utils/factories.js';
import { IssueFiltersBar } from './IssueFiltersBar.js';

const defaultProps = {
    filterKey: 'all' as const,
    onFilterChange: vi.fn(),
    counts: { all: 5, story: 2, bug: 1, sub_task: 1, sub_bug: 0, assigned_me: 1 },
    projects: [],
    projectFilter: null,
    onProjectChange: vi.fn(),
    agents: [],
    assigneeFilter: null,
    onAssigneeChange: vi.fn(),
    statusFilter: null,
    onStatusChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
};

describe('IssueFiltersBar', () => {
    it('renders all primary filter chips', () => {
        renderWithProviders(<IssueFiltersBar {...defaultProps} />);
        expect(screen.getByText('Stories')).toBeInTheDocument();
        expect(screen.getByText('Bugs')).toBeInTheDocument();
        expect(screen.getByText('Sub-tasks')).toBeInTheDocument();
        expect(screen.getByText('Sub-bugs')).toBeInTheDocument();
        expect(screen.getByText('Assigned to me')).toBeInTheDocument();
    });

    it('clicking a chip calls onFilterChange with the correct key', async () => {
        const onFilterChange = vi.fn();
        renderWithProviders(<IssueFiltersBar {...defaultProps} onFilterChange={onFilterChange} />);
        await userEvent.click(screen.getByText('Bugs'));
        expect(onFilterChange).toHaveBeenCalledWith('bug');
    });

    it('renders search input and calls onSearchChange when typed', async () => {
        const onSearchChange = vi.fn();
        renderWithProviders(<IssueFiltersBar {...defaultProps} onSearchChange={onSearchChange} />);
        const searchInput = screen.getByLabelText(/Search issues/i);
        await userEvent.type(searchInput, 'fix');
        expect(onSearchChange).toHaveBeenCalled();
    });

    it('renders Project dropdown with project options', async () => {
        const project = makeProject({ id: 'p1', name: 'Apollo' });
        renderWithProviders(<IssueFiltersBar {...defaultProps} projects={[project]} />);
        expect(screen.getByText(/Project/i)).toBeInTheDocument();
    });

    it('renders Assignee dropdown with active-agent options', async () => {
        const activeAgent = makeAgent({ id: 'a1', name: 'Coder', status: 'active' });
        const pausedAgent = makeAgent({ id: 'a2', name: 'Paused', status: 'inactive' });
        renderWithProviders(<IssueFiltersBar {...defaultProps} agents={[activeAgent, pausedAgent]} />);
        const assigneeChip = screen.getByText('Assignee:').closest('[role="button"]') as HTMLElement;
        await userEvent.click(assigneeChip!);
        await waitFor(() => expect(screen.getByText('Coder')).toBeInTheDocument());
        expect(screen.queryByText('Paused')).not.toBeInTheDocument();
    });

    it('selecting a status fires onStatusChange with the chosen value', async () => {
        const onStatusChange = vi.fn();
        renderWithProviders(<IssueFiltersBar {...defaultProps} onStatusChange={onStatusChange} />);
        const statusChip = screen.getByText('Status:').closest('[role="button"]') as HTMLElement;
        await userEvent.click(statusChip!);
        await waitFor(() => screen.getByText('Draft'));
        await userEvent.click(screen.getByText('Draft'));
        expect(onStatusChange).toHaveBeenCalledWith('draft');
    });

    it('shows the matching status label when statusFilter is set', () => {
        renderWithProviders(<IssueFiltersBar {...defaultProps} statusFilter="in_progress" />);
        const statusSection = screen.getByText('Status:').closest('[role="button"]');
        expect(statusSection?.textContent).toContain('In Progress');
    });

    it('selecting a project fires onProjectChange', async () => {
        const onProjectChange = vi.fn();
        const project = makeProject({ id: 'p1', name: 'Orion' });
        renderWithProviders(
            <IssueFiltersBar {...defaultProps} projects={[project]} onProjectChange={onProjectChange} />,
        );
        const projectChip = screen.getByText('Project:').closest('[role="button"]') as HTMLElement;
        await userEvent.click(projectChip!);
        await waitFor(() => screen.getByText('Orion'));
        await userEvent.click(screen.getByText('Orion'));
        expect(onProjectChange).toHaveBeenCalledWith('p1');
    });

    it('Owner option appears in Assignee dropdown and fires onAssigneeChange', async () => {
        const onAssigneeChange = vi.fn();
        renderWithProviders(<IssueFiltersBar {...defaultProps} onAssigneeChange={onAssigneeChange} />);
        const assigneeChip = screen.getByText('Assignee:').closest('[role="button"]') as HTMLElement;
        await userEvent.click(assigneeChip!);
        await waitFor(() => screen.getByText('Owner'));
        await userEvent.click(screen.getByText('Owner'));
        expect(onAssigneeChange).toHaveBeenCalledWith('owner');
    });
});
