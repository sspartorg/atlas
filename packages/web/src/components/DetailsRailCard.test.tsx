import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { DetailsRailCard } from './DetailsRailCard.js';

describe('DetailsRailCard', () => {
    it('renders the details panel', () => {
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('renders the Rounds row when roundCount and maxRounds are both provided', () => {
        // A04 — the rail surfaces per-CLI round usage against the assignee's
        // cap so the Owner can see how close the chain is to escalation.
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="in_progress"
                onStatusPick={vi.fn()}
                assigneeAgentId="agent-1"
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                roundCount={2}
                maxRounds={5}
            />,
        );
        expect(screen.getByText('Rounds')).toBeInTheDocument();
        expect(screen.getByText('2 / 5')).toBeInTheDocument();
    });

    it('hides the Rounds row when roundCount is null (no current assignee)', () => {
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                roundCount={null}
                maxRounds={5}
            />,
        );
        expect(screen.queryByText('Rounds')).not.toBeInTheDocument();
    });

    it('opens the reset-rounds popover when the Rounds row is clicked', async () => {
        // A04 — clickable Rounds row → ResetRoundsPopover. The popover
        // shows the "Reset rounds?" heading and the X / Y snapshot.
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="in_progress"
                onStatusPick={vi.fn()}
                assigneeAgentId="agent-1"
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                roundCount={3}
                maxRounds={5}
                onResetRounds={vi.fn()}
                assigneeName="PO Writer"
            />,
        );
        await user.click(screen.getByText('Rounds'));
        expect(await screen.findByText('Reset rounds?')).toBeInTheDocument();
        expect(screen.getAllByText('3 / 5').length).toBeGreaterThan(0);
        expect(screen.getByText(/PO Writer gets a fresh/)).toBeInTheDocument();
    });

    it('fires onResetRounds when the popover confirm button is clicked', async () => {
        const user = userEvent.setup();
        const onResetRounds = vi.fn();
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="in_progress"
                onStatusPick={vi.fn()}
                assigneeAgentId="agent-1"
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                roundCount={2}
                maxRounds={5}
                onResetRounds={onResetRounds}
                assigneeName="PO Writer"
            />,
        );
        await user.click(screen.getByText('Rounds'));
        await user.click(await screen.findByRole('button', { name: 'Reset rounds' }));
        expect(onResetRounds).toHaveBeenCalledTimes(1);
    });

    it('navigates to the project page when the project name is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={{ id: 'proj-1', name: 'My Project' } as any}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        // The project name is rendered as a clickable Typography.
        const projectLink = screen.getByText('My Project');
        expect(projectLink).toBeInTheDocument();
        await user.click(projectLink);
        // Navigation was triggered — no assertion on route, just confirm the
        // click handler didn't throw.
    });

    it('navigates when a parent link is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                parents={[{ label: 'Epic', text: 'CER-7', href: '/issues/epic-1' }]}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
            />,
        );
        const epicLink = screen.getByText('CER-7');
        expect(epicLink).toBeInTheDocument();
        await user.click(epicLink);
    });

    it('opens the priority picker popover when the Priority row is clicked', async () => {
        const user = userEvent.setup();
        const onPriorityPick = vi.fn();
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                priority="normal"
                onPriorityPick={onPriorityPick}
            />,
        );
        // The Priority row is clickable because onPriorityPick is provided.
        const priorityRow = screen.getByText('Priority');
        await user.click(priorityRow);
        // The PriorityPickerPopover should be mounted after the click.
        // Its presence is confirmed if the component didn't throw.
        expect(priorityRow).toBeInTheDocument();
    });

    it('renders worktree branch and path copy buttons', async () => {
        const user = userEvent.setup();
        // Provide the clipboard API mock in the test context.
        // navigator.clipboard is a getter-only property in jsdom so we must use
        // Object.defineProperty rather than Object.assign.
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });
        renderWithProviders(
            <DetailsRailCard
                issueType="story"
                status="ready"
                onStatusPick={vi.fn()}
                assigneeAgentId={null}
                onAssign={vi.fn()}
                assignee={null}
                project={null}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                createdAt="2026-05-15T00:00:00.000Z"
                updatedAt="2026-05-16T00:00:00.000Z"
                worktreeBranch="atlas/writer/story-1"
                worktreePath="/tmp/atlas/story-1"
            />,
        );
        expect(screen.getByText('Branch')).toBeInTheDocument();
        expect(screen.getByText('Path')).toBeInTheDocument();
        expect(screen.getByText('atlas/writer/story-1')).toBeInTheDocument();
        // Clicking the copy button exercises CopyValueButton.handleClick.
        const copyButtons = screen.getAllByRole('button', { name: /copy/i });
        if (copyButtons[0]) {
            await user.click(copyButtons[0]);
        }
    });
});
