import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { ResetRoundsPopover } from './ResetRoundsPopover.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

function makeAnchor(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('ResetRoundsPopover', () => {
    it('renders title, counter, and assignee name when open', () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <ResetRoundsPopover
                anchorEl={anchor}
                open
                onClose={() => {}}
                roundCount={3}
                maxRounds={5}
                assigneeName="Coder"
                onConfirm={() => {}}
            />,
        );
        expect(screen.getByText('Reset rounds?')).toBeInTheDocument();
        expect(screen.getByText(/Coder/)).toBeInTheDocument();
    });

    it('uses "this agent" fallback when assigneeName is null', () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <ResetRoundsPopover
                anchorEl={anchor}
                open
                onClose={() => {}}
                roundCount={0}
                maxRounds={5}
                assigneeName={null}
                onConfirm={() => {}}
            />,
        );
        expect(screen.getByText(/this agent/i)).toBeInTheDocument();
    });

    it('fires onCancel and onConfirm', () => {
        const anchor = makeAnchor();
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(
            <ResetRoundsPopover
                anchorEl={anchor}
                open
                onClose={onClose}
                roundCount={1}
                maxRounds={5}
                assigneeName="A"
                onConfirm={onConfirm}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reset rounds' }));
        expect(onClose).toHaveBeenCalled();
        expect(onConfirm).toHaveBeenCalled();
    });

    it('shows "Resetting…" and disables buttons when pending', () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <ResetRoundsPopover
                anchorEl={anchor}
                open
                onClose={() => {}}
                roundCount={1}
                maxRounds={5}
                assigneeName="A"
                onConfirm={() => {}}
                pending
            />,
        );
        const btn = screen.getByRole('button', { name: /resetting/i });
        expect(btn).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('renders nothing visible when open=false', () => {
        const anchor = makeAnchor();
        renderWithProviders(
            <ResetRoundsPopover
                anchorEl={anchor}
                open={false}
                onClose={() => {}}
                roundCount={1}
                maxRounds={5}
                assigneeName="A"
                onConfirm={() => {}}
            />,
        );
        expect(screen.queryByText('Reset rounds?')).not.toBeInTheDocument();
    });
});
