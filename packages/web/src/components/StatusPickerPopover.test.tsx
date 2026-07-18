import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { StatusPickerPopover } from './StatusPickerPopover.js';

// A real DOM element used as anchor for open=true cases.
function makeAnchor(): HTMLElement {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
}

describe('StatusPickerPopover', () => {
    it('mounts when closed', () => {
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={null}
                open={false}
                onClose={vi.fn()}
                issueType="story"
                current="ready"
                onPick={vi.fn()}
            />,
        );
    });

    it('open=true — "Move to" header and current status row are visible', async () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                issueType="story"
                current="ready"
                onPick={vi.fn()}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('Move to')).toBeInTheDocument();
            // STATUS_LABELS.ready = 'Ready'
            expect(screen.getByText('Ready')).toBeInTheDocument();
        });
    });

    it('open=true — valid next statuses are rendered as clickable rows', async () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                issueType="story"
                current="ready"
                onPick={vi.fn()}
            />,
        );
        // getValidNextStatuses('story', 'ready') = ['in_progress', 'waiting_for_info']
        await waitFor(() => {
            expect(screen.getByText('In Progress')).toBeInTheDocument();
            expect(screen.getByText('Waiting for Info')).toBeInTheDocument();
        });
    });

    it('onPick called with override=false when clicking a valid next status', async () => {
        const anchor = makeAnchor();
        const onPick = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                issueType="story"
                current="ready"
                onPick={onPick}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('In Progress')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('In Progress'));
        expect(onPick).toHaveBeenCalledWith('in_progress', false);
        expect(onClose).toHaveBeenCalled();
    });

    it('overrideOnly section — Divider and "Override" header rendered when override statuses exist', async () => {
        const anchor = makeAnchor();
        // current='ready' → validNext=['in_progress','waiting_for_info']
        // overrideOnly = all ISSUE_STATUSES except current and validNext
        // = ['draft','in_review','done']
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                issueType="story"
                current="ready"
                onPick={vi.fn()}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('Override')).toBeInTheDocument();
            // 'done' is in the override-only section
            expect(screen.getByText('Done')).toBeInTheDocument();
        });
    });

    it('onPick called with override=true when clicking an override status', async () => {
        const anchor = makeAnchor();
        const onPick = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                issueType="story"
                current="ready"
                onPick={onPick}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('Done')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Done'));
        expect(onPick).toHaveBeenCalledWith('done', true);
        expect(onClose).toHaveBeenCalled();
    });

    it('issueType other than sub_task — "story" uses getValidNextStatuses("story", current)', async () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={vi.fn()}
                issueType="epic"
                current="in_progress"
                onPick={vi.fn()}
            />,
        );
        // getValidNextStatuses('epic', 'in_progress') = ['in_review', 'ready', 'waiting_for_info']
        await waitFor(() => {
            expect(screen.getByText('In Review')).toBeInTheDocument();
            expect(screen.getByText('Ready')).toBeInTheDocument();
        });
    });

    it('current status row clicking calls onClose (not onPick)', async () => {
        const anchor = makeAnchor();
        const onClose = vi.fn();
        const onPick = vi.fn();
        renderWithProviders(
            <StatusPickerPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                issueType="bug"
                current="draft"
                onPick={onPick}
            />,
        );
        await waitFor(() => {
            expect(screen.getByText('Draft')).toBeInTheDocument();
        });
        // The current status row calls onClose only (not onPick)
        // Find the 'Draft' row and click it — it's the first match (isCurrent row)
        const draftItems = screen.getAllByText('Draft');
        fireEvent.click(draftItems[0]!);
        expect(onClose).toHaveBeenCalled();
        expect(onPick).not.toHaveBeenCalled();
    });
});
