import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';

// useDeferredMount currently returns `true` synchronously (skeleton path is
// dead code, kept for the future re-enable). Mock it to `false` on the
// skeleton-path tests so the wrapper branch is exercised for coverage.
vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

// Mock the child *Content modules so we don't drag their full dependency
// trees into this wrapper-only coverage test.
vi.mock('./HistoryTabContent.js', () => ({
    HistoryTabContent: ({ projectId }: { projectId: string }) => (
        <div data-testid="history-content">{projectId}</div>
    ),
}));
vi.mock('./TasksTabContent.js', () => ({
    TasksTabContent: ({ tasks }: { tasks: unknown }) => (
        <div data-testid="tasks-content">
            count={Array.isArray(tasks) ? tasks.length : '?'}
        </div>
    ),
}));

import { HistoryTab } from './HistoryTab.js';
import { TasksTab } from './TasksTab.js';

describe('HistoryTab wrapper', () => {
    it('renders the skeleton when useDeferredMount returns false', () => {
        mockMount.mockReturnValue(false);
        renderWithProviders(<HistoryTab projectId="p1" />);
        // Skeleton = MUI Skeleton elements; .MuiSkeleton-root is the class.
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('history-content')).not.toBeInTheDocument();
    });

    it('renders the Content child when useDeferredMount returns true', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<HistoryTab projectId="proj-xyz" />);
        expect(screen.getByTestId('history-content')).toHaveTextContent('proj-xyz');
    });
});

describe('TasksTab wrapper', () => {
    const baseProps = {
        projectId: 'p1',
        projects: [],
        agents: [],
        ownerName: 'Owner',
        ownerAccent: '#000',
    };

    it('renders the skeleton when not-ready', () => {
        mockMount.mockReturnValue(false);
        renderWithProviders(<TasksTab {...baseProps} tasks={[]} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
    });

    it('renders the skeleton when tasks is undefined (still loading) even if ready', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<TasksTab {...baseProps} tasks={undefined} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('tasks-content')).not.toBeInTheDocument();
    });

    it('renders the Content child once ready AND tasks has loaded', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<TasksTab {...baseProps} tasks={[]} />);
        expect(screen.getByTestId('tasks-content')).toBeInTheDocument();
    });
});
