import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { StatusTransitionBar } from './StatusTransitionBar.js';

describe('StatusTransitionBar', () => {
    it('renders terminal label for done', () => {
        renderWithProviders(
            <StatusTransitionBar
                issueType="epic"
                currentStatus="done"
                onTransition={vi.fn()}
            />,
        );
        expect(screen.getByText(/Terminal/)).toBeInTheDocument();
    });

    it('renders transition buttons for non-terminal status', async () => {
        const onTransition = vi.fn();
        renderWithProviders(
            <StatusTransitionBar
                issueType="story"
                currentStatus="ready"
                onTransition={onTransition}
            />,
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        await userEvent.click(buttons[0]!);
        expect(onTransition).toHaveBeenCalled();
    });

    it('disables buttons while loading=true', () => {
        renderWithProviders(
            <StatusTransitionBar
                issueType="story"
                currentStatus="draft"
                onTransition={vi.fn()}
                loading
            />,
        );
        const buttons = screen.getAllByRole('button');
        expect(buttons[0]).toBeDisabled();
    });

    it('renders terminal label for bug done status', () => {
        renderWithProviders(
            <StatusTransitionBar
                issueType="bug"
                currentStatus="done"
                onTransition={vi.fn()}
            />,
        );
        expect(screen.getByText(/Terminal/)).toBeInTheDocument();
    });

    it('shows "Transition to" label when transitions exist', () => {
        renderWithProviders(
            <StatusTransitionBar
                issueType="epic"
                currentStatus="draft"
                onTransition={vi.fn()}
            />,
        );
        expect(screen.getByText(/Transition to/i)).toBeInTheDocument();
    });

    it('calls onTransition with the correct status value on click', async () => {
        const onTransition = vi.fn();
        renderWithProviders(
            <StatusTransitionBar
                issueType="story"
                currentStatus="draft"
                onTransition={onTransition}
            />,
        );
        const buttons = screen.getAllByRole('button');
        await userEvent.click(buttons[0]!);
        expect(onTransition).toHaveBeenCalledWith(expect.any(String));
    });
});
