import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { QueueAgentCard } from './QueueAgentCard.js';
import type { AgentQueueSummary } from './queueViewModel.js';
import type { QueueItem } from './queueViewModel.js';
import type { IAgentRun } from '@atlas/shared';

const makeQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    id: 'ATL-2',
    type: 'story',
    displayId: 'ATL-2',
    title: 'Story One',
    status: 'ready',
    assignee_agent_id: 'agent-coder',
    project_id: 'p1',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
});

const makeAgentRun = (): IAgentRun => ({
    id: 'run-1',
    agent_id: 'agent-coder',
    issue_id: 'ATL-2',
    issue_type: 'story',
    project_id: null,
    status: 'completed',
    prompt_snapshot: null,
    output_text: null,
    started_at: null,
    completed_at: null,
    parent_run_id: null,
    setup_output_text: null,
    outcome_kind: null,
    outcome_summary: null,
    outcome_reason: null,
    outcome_checklist: null,
    created_at: '2026-05-16T00:00:00.000Z',
    input_tokens: null,
    output_tokens: null,
    cache_creation_tokens: null,
    cache_read_tokens: null,
    total_cost_usd: null,
    credits: null,
    item_title: null,
});

function makeSummary(overrides: Partial<AgentQueueSummary> = {}): AgentQueueSummary {
    return {
        agent: makeAgent(),
        running: [],
        queued: [],
        nextRunItem: null,
        lastCompletedItem: null,
        lastCompletedAt: null,
        lastRun: null,
        totalAssigned: 0,
        ...overrides,
    };
}

describe('QueueAgentCard', () => {
    it('renders agent name and status label', () => {
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('renders "nothing waiting" when queue is empty', () => {
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('nothing waiting')).toBeInTheDocument();
    });

    it('renders queued item when present', () => {
        const item = makeQueueItem({ id: 'ATL-7', displayId: 'ATL-7', title: 'Feature X' });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({ queued: [item], nextRunItem: item, totalAssigned: 1 })}
                statusLabel="Idle"
                projectNameById={new Map([['p1', 'Alpha']])}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('Feature X')).toBeInTheDocument();
        expect(screen.getAllByText('ATL-7').length).toBeGreaterThan(0);
    });

    it('calls onOpen when card is clicked', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={onOpen}
            />,
        );
        // The outer card is role=button; clicking it calls onOpen
        const card = screen.getByRole('button');
        fireEvent.click(card);
        expect(onOpen).toHaveBeenCalledWith(makeAgent());
    });

    it('renders Running status label with live dot', () => {
        const runningItem = makeQueueItem({ status: 'in_progress' });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({ running: [runningItem], nextRunItem: runningItem })}
                statusLabel="Running"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders Failed status label', () => {
        const run = makeAgentRun();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({ lastRun: { ...run, status: 'error' } })}
                statusLabel="Failed"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('renders "view all" button when more than 3 queued items', () => {
        const items = [
            makeQueueItem({ id: 'i1', displayId: 'ATL-1', title: 'A' }),
            makeQueueItem({ id: 'i2', displayId: 'ATL-2', title: 'B' }),
            makeQueueItem({ id: 'i3', displayId: 'ATL-3', title: 'C' }),
            makeQueueItem({ id: 'i4', displayId: 'ATL-4', title: 'D' }),
        ];
        const onOpen = vi.fn();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({ queued: items, totalAssigned: 4 })}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={onOpen}
            />,
        );
        expect(screen.getByText(/view all/)).toBeInTheDocument();
        fireEvent.click(screen.getByText(/view all/));
        expect(onOpen).toHaveBeenCalled();
    });

    it('renders last completed item when provided', () => {
        const completedItem = makeQueueItem({
            id: 'ATL-5',
            displayId: 'ATL-5',
            title: 'Completed task',
        });
        const run = makeAgentRun();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({
                    lastCompletedItem: completedItem,
                    lastRun: run,
                    lastCompletedAt: '2026-05-16T00:00:00.000Z',
                })}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        // displayId appears in the Last Completed section
        expect(screen.getAllByText('ATL-5').length).toBeGreaterThan(0);
    });

    it('renders "nothing queued" text in the Next Run section when no next item', () => {
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('nothing queued')).toBeInTheDocument();
    });

    it('renders selected state without crashing', () => {
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                selected
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
    });

    it('calls onOpen when Enter key is pressed on the card (line 76 branch)', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={onOpen}
            />,
        );
        const card = screen.getByRole('button');
        fireEvent.keyDown(card, { key: 'Enter' });
        expect(onOpen).toHaveBeenCalledWith(makeAgent());
    });

    it('calls onOpen when Space key is pressed on the card (line 76 branch)', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={onOpen}
            />,
        );
        const card = screen.getByRole('button');
        fireEvent.keyDown(card, { key: ' ' });
        expect(onOpen).toHaveBeenCalledWith(makeAgent());
    });

    it('does not call onOpen for unrelated key press (line 76 false branch)', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary()}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={onOpen}
            />,
        );
        const card = screen.getByRole('button');
        fireEvent.keyDown(card, { key: 'Tab' });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('shows "running" badge when an item in visibleQueue is also in running — covers lines 452-462', () => {
        // Make the same item appear in both running and queued so isRunningItem===true
        // and idx===0 so the "· running" badge renders (lines 453-462)
        const runningItem = makeQueueItem({ id: 'ATL-99', displayId: 'ATL-99', title: 'Active task' });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({
                    running: [runningItem],
                    queued: [runningItem],
                    nextRunItem: runningItem,
                    totalAssigned: 1,
                })}
                statusLabel="Running"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        // The "· running" span is rendered alongside the project name cell
        expect(document.body.textContent).toContain('running');
        expect(screen.getByText('Active task')).toBeInTheDocument();
    });

    it('shows "running now" in Next Run section when statusLabel is Running with nextRunItem', () => {
        // Line 249: isRunning ? 'running now' : view.nextPassDelta
        const runningItem = makeQueueItem({ id: 'ATL-10', displayId: 'ATL-10', title: 'Running Work' });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({
                    running: [runningItem],
                    queued: [runningItem],
                    nextRunItem: runningItem,
                    totalAssigned: 1,
                })}
                statusLabel="Running"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('running now')).toBeInTheDocument();
    });

    it('shows relativeTimeShort in Last Completed when lastCompletedAt is non-null', () => {
        // Line 326: lastCompletedAt ? ` · ${relativeTimeShort(lastCompletedAt)}` : ''
        const completedItem = makeQueueItem({ id: 'ATL-20', displayId: 'ATL-20', title: 'Done Work' });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({
                    lastCompletedItem: completedItem,
                    lastRun: makeAgentRun(),
                    lastCompletedAt: '2026-05-16T00:00:00.000Z',
                })}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        // lastCompletedAt is non-null, so relativeTimeShort renders a time suffix
        expect(screen.getByText('ATL-20')).toBeInTheDocument();
        expect(document.body.textContent).toContain('Done Work');
    });

    it('renders "—" for project when item has null project_id (projectName ?? "—" branch)', () => {
        // Line 451: {projectName ?? '—'} — project_id null → projectName = null → shows '—'
        const noProjectItem = makeQueueItem({ id: 'ATL-30', displayId: 'ATL-30', title: 'No Project', project_id: undefined as unknown as string });
        renderWithProviders(
            <QueueAgentCard
                summary={makeSummary({
                    queued: [noProjectItem],
                    nextRunItem: noProjectItem,
                    totalAssigned: 1,
                })}
                statusLabel="Idle"
                projectNameById={new Map()}
                onOpen={vi.fn()}
            />,
        );
        expect(screen.getByText('No Project')).toBeInTheDocument();
    });
});
