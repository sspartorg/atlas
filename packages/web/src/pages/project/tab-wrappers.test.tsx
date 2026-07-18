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
vi.mock('./EpicsTabContent.js', () => ({
    EpicsTabContent: ({ epics }: { epics: unknown }) => (
        <div data-testid="epics-content">
            count={Array.isArray(epics) ? epics.length : '?'}
        </div>
    ),
}));
vi.mock('./IssuesTabContent.js', () => ({
    IssuesTabContent: () => <div data-testid="issues-content" />,
}));

import { HistoryTab } from './HistoryTab.js';
import { EpicsTab } from './EpicsTab.js';
import { IssuesTab } from './IssuesTab.js';

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

describe('EpicsTab wrapper', () => {
    const baseProps = {
        projectId: 'p1',
        projects: [],
        agents: [],
        ownerName: 'Owner',
        ownerAccent: '#000',
    };

    it('renders the skeleton when not-ready', () => {
        mockMount.mockReturnValue(false);
        renderWithProviders(<EpicsTab {...baseProps} epics={[]} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
    });

    it('renders the skeleton when epics is undefined (still loading) even if ready', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<EpicsTab {...baseProps} epics={undefined as unknown as never[]} />);
        // Either skeleton OR content — verify skeleton is shown because epics is undefined.
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('epics-content')).not.toBeInTheDocument();
    });

    it('renders the Content child once ready AND epics has loaded', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<EpicsTab {...baseProps} epics={[]} />);
        expect(screen.getByTestId('epics-content')).toBeInTheDocument();
    });
});

describe('IssuesTab wrapper', () => {
    const baseProps = {
        projectId: 'p1',
        agentsById: new Map(),
        ownerName: 'Owner',
        ownerAccent: '#000',
        formatRelative: (iso: string) => iso,
    };

    it('renders the skeleton when not-ready', () => {
        mockMount.mockReturnValue(false);
        renderWithProviders(<IssuesTab {...baseProps} treeData={undefined} />);
        // 5 skeleton rows expected.
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBe(5);
    });

    it('renders the skeleton when treeData is still undefined even if ready', () => {
        mockMount.mockReturnValue(true);
        renderWithProviders(<IssuesTab {...baseProps} treeData={undefined} />);
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBe(5);
        expect(screen.queryByTestId('issues-content')).not.toBeInTheDocument();
    });

    it('renders the Content child once ready AND treeData has loaded', () => {
        mockMount.mockReturnValue(true);
        // Cast tree to never[] shape — content is mocked, doesn't read.
        renderWithProviders(
            <IssuesTab {...baseProps} treeData={{ stories: [], bugs: [] } as never} />,
        );
        expect(screen.getByTestId('issues-content')).toBeInTheDocument();
    });
});
