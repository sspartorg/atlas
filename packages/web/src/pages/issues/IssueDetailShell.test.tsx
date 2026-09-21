import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { IssueDetailShell, IssueDetailLoading } from './IssueDetailShell.js';

describe('IssueDetailLoading', () => {
    it('renders skeleton blocks', () => {
        const { container } = renderWithProviders(<IssueDetailLoading withBreadcrumb />);
        expect(container.firstChild).toBeInTheDocument();
    });
});

describe('IssueDetailShell', () => {
    it('renders title and breadcrumbs', () => {
        renderWithProviders(
            <IssueDetailShell
                breadcrumbs={[
                    { label: 'Tasks', href: '/tasks' },
                    { label: 'S1', mono: true },
                ]}
                title="My task"
                onTitleSave={vi.fn().mockResolvedValue(undefined)}
                issueType="task"
                rightRail={<div>rail</div>}
            >
                <div>body</div>
            </IssueDetailShell>
        );
        expect(screen.getByText('My task')).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
    });

    it('clicking a breadcrumb with href navigates to that route', () => {
        renderWithProviders(
            <Routes>
                <Route path="/tasks" element={<div data-testid="tasks-page">Tasks</div>} />
                <Route
                    path="/sub-tasks/S1"
                    element={
                        <IssueDetailShell
                            breadcrumbs={[
                                { label: 'Tasks', href: '/tasks' },
                                { label: 'S1', mono: true },
                            ]}
                            title="My task"
                            onTitleSave={vi.fn().mockResolvedValue(undefined)}
                            issueType="task"
                            rightRail={<div>rail</div>}
                        >
                            <div>body</div>
                        </IssueDetailShell>
                    }
                />
            </Routes>,
            { initialEntries: ['/sub-tasks/S1'] }
        );
        expect(screen.getByText('My task')).toBeInTheDocument();
        // Click the "Tasks" breadcrumb which has href="/tasks"
        fireEvent.click(screen.getByText('Tasks'));
        expect(screen.getByTestId('tasks-page')).toBeInTheDocument();
    });

    it('renders headerExtras when provided', () => {
        renderWithProviders(
            <IssueDetailShell
                breadcrumbs={[
                    { label: 'Tasks', href: '/tasks' },
                    { label: 'S1', mono: true },
                ]}
                title="My task"
                onTitleSave={vi.fn().mockResolvedValue(undefined)}
                issueType="task"
                headerExtras={<div data-testid="extras">Extras</div>}
                rightRail={<div>rail</div>}
            >
                <div>body</div>
            </IssueDetailShell>
        );
        expect(screen.getByTestId('extras')).toBeInTheDocument();
    });

    it('renders actions when provided (covers actions truthy branch, line 129)', () => {
        renderWithProviders(
            <IssueDetailShell
                breadcrumbs={[
                    { label: 'Tasks', href: '/tasks' },
                    { label: 'S1', mono: true },
                ]}
                title="Task with actions"
                onTitleSave={vi.fn().mockResolvedValue(undefined)}
                issueType="task"
                actions={<button>Delete</button>}
                rightRail={<div>rail</div>}
            >
                <div>body</div>
            </IssueDetailShell>
        );
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('clicking a breadcrumb without href does not navigate (covers no-href branch, line 86)', () => {
        renderWithProviders(
            <IssueDetailShell
                breadcrumbs={[{ label: 'No-href crumb' }, { label: 'S2', mono: true }]}
                title="Task two"
                onTitleSave={vi.fn().mockResolvedValue(undefined)}
                issueType="sub_task"
                rightRail={<div>rail</div>}
            >
                <div>body</div>
            </IssueDetailShell>
        );
        // Click the breadcrumb that has no href — should not throw
        fireEvent.click(screen.getByText('No-href crumb'));
        expect(screen.getByText('Task two')).toBeInTheDocument();
    });

    it('renders IssueDetailLoading without breadcrumb (covers withBreadcrumb=false branch)', () => {
        const { container } = renderWithProviders(<IssueDetailLoading />);
        expect(container.firstChild).toBeInTheDocument();
        // The skeleton should render but withBreadcrumb is false so no breadcrumb skeleton
        expect(container.querySelector('[class*="MuiSkeleton"]')).toBeInTheDocument();
    });

    it('renders with 3+ breadcrumb steps (covers i > 0 separator branch for multiple steps)', () => {
        renderWithProviders(
            <IssueDetailShell
                breadcrumbs={[
                    { label: 'Projects', href: '/projects' },
                    { label: 'Alpha', href: '/projects/alpha' },
                    { label: 'ST-42', mono: true },
                ]}
                title="Sub-task title"
                onTitleSave={vi.fn().mockResolvedValue(undefined)}
                issueType="sub_task"
                rightRail={<div>rail</div>}
            >
                <div>children</div>
            </IssueDetailShell>
        );
        expect(screen.getByText('Projects')).toBeInTheDocument();
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('ST-42')).toBeInTheDocument();
    });
});
