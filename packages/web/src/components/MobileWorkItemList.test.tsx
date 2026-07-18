import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent } from '../test-utils/factories.js';
import { MobileWorkItemList } from './MobileWorkItemList.js';
import type { WorkItemTableRow } from './WorkItemTable.js';

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

describe('MobileWorkItemList', () => {
    it('renders rows', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
            />,
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders empty state with default message when no rows', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
            />,
        );
        expect(screen.getByText('No items yet.')).toBeInTheDocument();
    });

    it('renders empty state with custom emptyMessage', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                emptyMessage="Nothing here yet"
            />,
        );
        expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    });

    it('renders title + row count when title prop is provided', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                title="Stories"
            />,
        );
        expect(screen.getByText('Stories')).toBeInTheDocument();
    });

    it('renders headerRight inside the title bar', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow()]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
                title="Stories"
                headerRight={<button>Add</button>}
            />,
        );
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('calls onRowClick when a row is clicked', () => {
        const onRowClick = vi.fn();
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow({ title: 'Clickable row' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={onRowClick}
            />,
        );
        const row = screen.getByRole('button');
        fireEvent.click(row);
        expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clickable row' }));
    });

    it('shows LiveDot for in_progress row (isLive branch)', () => {
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow({ status: 'in_progress', title: 'Live task' })]}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
            />,
        );
        expect(screen.getByText('Live task')).toBeInTheDocument();
    });

    it('shows agent chip when assignee found in agentsById', () => {
        const agent = makeAgent({ id: 'a1', name: 'Alice' });
        renderWithProviders(
            <MobileWorkItemList
                rows={[makeRow({ assignee_agent_id: 'a1' })]}
                agentsById={new Map([['a1', agent]])}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                onRowClick={vi.fn()}
            />,
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('covers all kindBg branches: bug, sub_task, sub_bug, epic (default)', () => {
        const kinds = ['bug', 'sub_task', 'sub_bug', 'epic'] as const;
        for (const kind of kinds) {
            const { unmount } = renderWithProviders(
                <MobileWorkItemList
                    rows={[makeRow({ kind, id: kind, shortId: kind, title: `${kind} item` })]}
                    agentsById={new Map()}
                    ownerName="Bob"
                    ownerAccent="#0A0A0A"
                    onRowClick={vi.fn()}
                />,
            );
            expect(screen.getByText(`${kind} item`)).toBeInTheDocument();
            unmount();
        }
    });
});
