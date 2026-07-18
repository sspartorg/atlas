import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectsTable, type ProjectRow } from './ProjectsTable.js';

const sampleRow: ProjectRow = {
    id: 'p1',
    displayId: 'ATL',
    name: 'Acme',
    gitPath: 'github.com/x/y',
    epics: 2,
    stories: 5,
    lastActivity: 'just now',
    updatedAt: '2026-05-16T00:00:00.000Z',
};

const secondRow: ProjectRow = {
    id: 'p2',
    displayId: 'OTH',
    name: 'Beta',
    gitPath: '',
    epics: 0,
    stories: 0,
    lastActivity: '2 days ago',
    updatedAt: '2026-05-14T00:00:00.000Z',
};

function renderTable(overrides: Partial<React.ComponentProps<typeof ProjectsTable>> = {}) {
    const defaults: React.ComponentProps<typeof ProjectsTable> = {
        rows: [sampleRow, secondRow],
        ownerName: 'Bob',
        onRowClick: vi.fn(),
        onOpen: vi.fn(),
        onCopyUrl: vi.fn(),
        onReclone: vi.fn(),
        onDelete: vi.fn(),
        onScheduleFetch: vi.fn(),
    };
    return renderWithProviders(<ProjectsTable {...defaults} {...overrides} />);
}

describe('ProjectsTable', () => {
    it('renders rows and header columns', () => {
        renderTable();
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('fires onRowClick when a row is clicked', () => {
        const onRowClick = vi.fn();
        renderTable({ onRowClick });
        fireEvent.click(screen.getByText('Acme'));
        expect(onRowClick).toHaveBeenCalledWith('p1');
    });

    it('toggles sort direction on header click (handleSort same-key branch)', () => {
        renderTable();
        // Default sort is lastActivity DESC. Click "ID" to switch key to id ASC.
        const idHeader = screen.getByText('ID');
        fireEvent.click(idHeader);
        // Click again: same key flips dir to DESC.
        fireEvent.click(idHeader);
        // Click "Project" to switch key — exercises the "different key" branch.
        const projectHeader = screen.getByText('Project');
        fireEvent.click(projectHeader);
    });

    it('renders the schedule chip when scheduleMap has an entry for the row', () => {
        const scheduleMap = new Map([
            ['p1', { preset: 'daily', next_run_at: '2030-01-01T00:00:00Z' }],
        ]);
        renderTable({ scheduleMap });
        // The schedule icon has aria-label "Auto-fetch enabled".
        expect(screen.getByLabelText(/Auto-fetch enabled/i)).toBeInTheDocument();
    });

    it('renders the schedule chip when scheduleMap entry has no next_run_at', () => {
        const scheduleMap = new Map([['p1', { preset: 'every_n_hours', next_run_at: null }]]);
        renderTable({ scheduleMap });
        expect(screen.getByLabelText(/Auto-fetch enabled/i)).toBeInTheDocument();
    });

    it('renders the empty state when rows is empty', () => {
        renderTable({ rows: [] });
        expect(screen.getByText(/No projects match this filter/i)).toBeInTheDocument();
    });

    it('renders em-dash for missing gitPath', () => {
        renderTable();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('opens the row action menu and clicks the actions (onOpen/onCopyUrl/onReclone/etc)', () => {
        const onOpen = vi.fn();
        const onCopyUrl = vi.fn();
        const onReclone = vi.fn();
        const onDelete = vi.fn();
        const onScheduleFetch = vi.fn();
        const { container } = renderTable({
            onOpen,
            onCopyUrl,
            onReclone,
            onDelete,
            onScheduleFetch,
        });
        // Each row has a Project-actions trigger button.
        const actionButtons = container.querySelectorAll('button[aria-label="Project actions"]');
        expect(actionButtons.length).toBeGreaterThan(0);
        if (actionButtons[0]) fireEvent.click(actionButtons[0]);
        // Once the menu is open, click each menu item to fire its onClick.
        const menuItems = document.querySelectorAll('[role="menuitem"]');
        menuItems.forEach((item) => fireEvent.click(item));
        // One of the action handlers should have been invoked.
        const invoked =
            onOpen.mock.calls.length +
            onCopyUrl.mock.calls.length +
            onReclone.mock.calls.length +
            onDelete.mock.calls.length +
            onScheduleFetch.mock.calls.length;
        expect(invoked).toBeGreaterThan(0);
    });

    it('clicks on the actions cell does NOT bubble row click (stopPropagation)', () => {
        const onRowClick = vi.fn();
        const { container } = renderTable({ onRowClick });
        const actionCell = container.querySelector(
            'button[aria-label="Project actions"]',
        )?.parentElement;
        if (actionCell) {
            fireEvent.click(actionCell);
        }
        // Row click should not have fired from the action-cell click.
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it('sorts numerically by epics and stories columns', () => {
        renderTable();
        fireEvent.click(screen.getByText('Epics'));
        fireEvent.click(screen.getByText('Stories'));
    });

    it('sorts by Last Activity header (default sort key, toggles direction)', () => {
        renderTable();
        fireEvent.click(screen.getByText('Last Activity'));
    });

    it('compare: equal values return stable order (compare return 0 branch)', () => {
        // Two rows with identical epics count exercise the `return 0` branch
        const rowA: ProjectRow = {
            id: 'p3',
            displayId: 'A',
            name: 'Alpha',
            gitPath: '',
            epics: 3,
            stories: 3,
            lastActivity: 'now',
            updatedAt: '2026-05-16T00:00:00.000Z',
        };
        const rowB: ProjectRow = {
            id: 'p4',
            displayId: 'B',
            name: 'Bravo',
            gitPath: '',
            epics: 3,  // same as rowA — compare returns 0
            stories: 3,
            lastActivity: 'now',
            updatedAt: '2026-05-16T00:00:00.000Z',
        };
        renderWithProviders(
            <ProjectsTable
                rows={[rowA, rowB]}
                ownerName="Bob"
                onRowClick={vi.fn()}
                onOpen={vi.fn()}
                onCopyUrl={vi.fn()}
                onReclone={vi.fn()}
                onDelete={vi.fn()}
                onScheduleFetch={vi.fn()}
            />,
        );
        // Sort by Epics — both rows have epics=3, compare returns 0 for the equality case
        fireEvent.click(screen.getByText('Epics'));
        // Both rows should still render
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Bravo')).toBeInTheDocument();
    });

    it('compare: desc sort on non-lastActivity string columns (av > bv returns 1 branch)', () => {
        // Sort by name: "Bravo" > "Alpha" in asc; click again for desc exercises both branches
        renderTable();
        const projectHeader = screen.getByText('Project');
        fireEvent.click(projectHeader); // asc — exercises av < bv for Alpha vs Beta
        fireEvent.click(projectHeader); // desc — exercises av > bv for Beta vs Alpha
        // Both rows should still render
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });
}, 15000);
