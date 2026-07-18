import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import { WorkItemTable, type WorkItemTableRow } from './WorkItemTable.js';

function makeRow(overrides: Partial<WorkItemTableRow> = {}): WorkItemTableRow {
    return {
        id: 'S1',
        kind: 'story',
        shortId: 'S1',
        title: 'Hello',
        status: 'ready',
        assignee_agent_id: null,
        reporter_agent_id: null,
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

describe('WorkItemTable', () => {
    it('renders rows', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders an empty message when no rows', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                emptyMessage="Nothing yet"
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    });

    it('returns null when hideWhenEmpty=true and rows is empty', () => {
        const { container } = renderWithProviders(
            <WorkItemTable
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                hideWhenEmpty
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders title + count header when title prop is set', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                title="Stories"
            />,
        );
        expect(screen.getByText('Stories')).toBeInTheDocument();
    });

    it('renders headerRight slot inside the title bar', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                title="Stories"
                headerRight={<button>Add</button>}
            />,
        );
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('renders rowAction for each row (rowAction branch)', () => {
        const rowAction = vi.fn(() => <button>Action</button>);
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                rowAction={rowAction}
            />,
        );
        expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
        expect(rowAction).toHaveBeenCalled();
    });

    it('calls onRowClick when a row is clicked', () => {
        const onRowClick = vi.fn();
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ title: 'Clickable' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={onRowClick}
                formatRelative={() => 'just now'}
            />,
        );
        const row = screen.getByRole('button');
        fireEvent.click(row);
        expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clickable' }));
    });

    it('shows LiveDot column when showLiveDot=true and row is in_progress', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ status: 'in_progress' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                showLiveDot
            />,
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders an isChild row with indented layout', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ title: 'Parent' }), makeRow({ id: 'S2', shortId: 'S2', title: 'Child task', isChild: true })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getByText('Child task')).toBeInTheDocument();
    });

    it('uses agent chip when reporter/assignee are found in agentsById', () => {
        const agent = makeAgent({ id: 'agent-1', name: 'Alice' });
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ reporter_agent_id: 'agent-1', assignee_agent_id: 'agent-1' })]}
                agentsById={new Map([['agent-1', agent]])}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    });

    it('renders sortable headers when sort prop is provided', () => {
        const sortOnChange = vi.fn();
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                sort={{
                    current: 'id',
                    dir: 'asc',
                    onChange: sortOnChange,
                    sortable: new Set(['id', 'title', 'status', 'updated']),
                }}
            />,
        );
        // Click an ID header to exercise sort.onChange
        const idHeaders = screen.getAllByText('ID');
        fireEvent.click(idHeaders[0]!);
        expect(sortOnChange).toHaveBeenCalledWith('id');
    });

    it('default empty message uses title when provided but emptyMessage not given', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                title="Links"
            />,
        );
        expect(screen.getByText(/No links yet/i)).toBeInTheDocument();
    });

    it('default empty message falls back to "No items." when no title/emptyMessage', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getByText('No items.')).toBeInTheDocument();
    });

    it('renders MobileWorkItemList when isMobile=true (useIsMobile → true)', () => {
        // Force matchMedia to report xs breakpoint (mobile) so useIsMobile() returns true
        const origMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('600') ? false : query.includes('(max-width') ? true : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ title: 'Mobile Story' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        // MobileWorkItemList renders rows in a card format — title still present
        expect(document.body.textContent).toContain('Mobile Story');
        window.matchMedia = origMatchMedia;
    });

    it('renders virtualized body when rows.length >= VIRTUALIZE_THRESHOLD (60)', () => {
        const rows = Array.from({ length: 65 }, (_, i) =>
            makeRow({ id: `S${i}`, shortId: `S${i}`, title: `Row ${i}` }),
        );
        renderWithProviders(
            <WorkItemTable
                rows={rows}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        // Virtualised body renders a subset (overscan window) of the 65 rows.
        expect(screen.getAllByText(/Row \d+/).length).toBeGreaterThan(0);
    });

    it('clicking a row inside the virtualized body calls onRowClick', () => {
        const onRowClick = vi.fn();
        const rows = Array.from({ length: 61 }, (_, i) =>
            makeRow({ id: `S${i}`, shortId: `S${i}`, title: `VRow ${i}` }),
        );
        renderWithProviders(
            <WorkItemTable
                rows={rows}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={onRowClick}
                formatRelative={() => 'just now'}
            />,
        );
        const firstRowText = screen.getAllByText(/VRow \d+/)[0]!;
        fireEvent.click(firstRowText);
        expect(onRowClick).toHaveBeenCalled();
    });

    it('virtualized body resolves reporter/assignee from agentsById when found', () => {
        const agent = makeAgent({ id: 'agent-v1', name: 'Virtual Agent' });
        const rows = Array.from({ length: 61 }, (_, i) =>
            makeRow({
                id: `S${i}`,
                shortId: `S${i}`,
                title: `VRow ${i}`,
                reporter_agent_id: 'agent-v1',
                assignee_agent_id: 'agent-v1',
            }),
        );
        renderWithProviders(
            <WorkItemTable
                rows={rows}
                agentsById={new Map([['agent-v1', agent]])}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getAllByText('Virtual Agent').length).toBeGreaterThan(0);
    });

    it('virtualized body falls back to null when reporter/assignee id is not in agentsById', () => {
        const rows = Array.from({ length: 61 }, (_, i) =>
            makeRow({
                id: `S${i}`,
                shortId: `S${i}`,
                title: `VRow ${i}`,
                reporter_agent_id: 'missing-agent',
                assignee_agent_id: 'missing-agent',
            }),
        );
        renderWithProviders(
            <WorkItemTable
                rows={rows}
                agentsById={new Map()}
                ownerName="FallbackOwner"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getAllByText('FallbackOwner').length).toBeGreaterThan(0);
    });

    it('passes title through to MobileWorkItemList when set and isMobile=true', () => {
        const origMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('600') ? false : query.includes('(max-width') ? true : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ title: 'Mobile With Title' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                title="Mobile Section"
            />,
        );
        expect(document.body.textContent).toContain('Mobile Section');
        window.matchMedia = origMatchMedia;
    });

    it('clicking the rowAction area stops propagation and does not trigger onRowClick', () => {
        const onRowClick = vi.fn();
        const rowAction = vi.fn(() => <button>Action</button>);
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={onRowClick}
                formatRelative={() => 'just now'}
                rowAction={rowAction}
            />,
        );
        const actionButton = screen.getByRole('button', { name: 'Action' });
        fireEvent.click(actionButton.parentElement!);
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it('renderHeader falls through to plain Typography when key is not in sort.sortable', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                sort={{
                    current: 'id',
                    dir: 'asc',
                    onChange: vi.fn(),
                    // Only 'id' is sortable — 'title', 'status', 'updated' headers
                    // fall through to the plain <Typography> branch.
                    sortable: new Set(['id']),
                }}
            />,
        );
        // Plain (non-sortable) headers still render their label text.
        expect(screen.getByText('Issue')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('renders non-empty rows normally when hideWhenEmpty=true (false branch of the empty check)', () => {
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ title: 'Still visible' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                hideWhenEmpty
            />,
        );
        expect(screen.getByText('Still visible')).toBeInTheDocument();
    });

    it('builds grid template with both showLiveDot and rowAction columns present', () => {
        const rowAction = vi.fn(() => <button>Do</button>);
        renderWithProviders(
            <WorkItemTable
                rows={[makeRow({ status: 'in_progress', title: 'Combo row' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
                showLiveDot
                rowAction={rowAction}
            />,
        );
        expect(screen.getByText('Combo row')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Do' })).toBeInTheDocument();
    });

    it('handles assignee and reporter not in agentsById (null fallback path)', () => {
        const row = makeRow({
            assignee_agent_id: 'missing-agent-1',
            reporter_agent_id: 'missing-agent-2',
        });
        renderWithProviders(
            <WorkItemTable
                rows={[row]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                formatRelative={() => 'just now'}
            />,
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });
});
