import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { EditableTitle } from './EditableTitle.js';

describe('EditableTitle', () => {
    it('renders the read-only value', () => {
        renderWithProviders(<EditableTitle value="Hello" onSave={vi.fn()} />);
        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('enters edit mode on click and saves on Enter', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(<EditableTitle value="Old" onSave={onSave} />);
        await userEvent.click(screen.getByText('Old'));
        const input = screen.getByDisplayValue('Old');
        await userEvent.clear(input);
        await userEvent.type(input, 'New');
        await userEvent.keyboard('{Enter}');
        expect(onSave).toHaveBeenCalledWith('New');
    });

    it('cancels on Escape', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="X" onSave={onSave} />);
        await userEvent.click(screen.getByText('X'));
        await userEvent.keyboard('{Escape}');
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('X')).toBeInTheDocument();
    });

    it('does not call onSave when text unchanged', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="Same" onSave={onSave} />);
        await userEvent.click(screen.getByText('Same'));
        await userEvent.keyboard('{Enter}');
        expect(onSave).not.toHaveBeenCalled();
    });

    it('updates draft when value prop changes while not in edit mode (useEffect path)', async () => {
        // Render with initial value, then rerender with a new value to trigger useEffect
        const onSave = vi.fn();
        const { rerender } = renderWithProviders(<EditableTitle value="First" onSave={onSave} />);
        expect(screen.getByText('First')).toBeInTheDocument();
        await act(async () => {
            rerender(<EditableTitle value="Updated" onSave={onSave} />);
        });
        expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('cancel button in edit mode calls cancel', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="Title" onSave={onSave} />);
        // Enter edit mode
        await userEvent.click(screen.getByText('Title'));
        // Click the cancel (close) icon button
        const buttons = screen.getAllByRole('button');
        // In edit mode: [check, close] buttons
        const cancelBtn = buttons.find((b) => b.querySelector('svg[data-testid="CloseRoundedIcon"]') !== null) ?? buttons[buttons.length - 1]!;
        fireEvent.click(cancelBtn);
        expect(screen.getByText('Title')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('Shift+Enter does not save (shiftKey guard branch)', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="A" onSave={onSave} />);
        await userEvent.click(screen.getByText('A'));
        const input = screen.getByDisplayValue('A');
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(onSave).not.toHaveBeenCalled();
        // Still in edit mode
        expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    });

    it('Enter with empty draft cancels (empty-string early return)', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="Foo" onSave={onSave} />);
        await userEvent.click(screen.getByText('Foo'));
        const input = screen.getByDisplayValue('Foo');
        await userEvent.clear(input);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
        // Edit mode should have exited (cancel)
        expect(screen.getByText('Foo')).toBeInTheDocument();
    });

    it('Edit affordance icon button opens edit mode', async () => {
        const onSave = vi.fn();
        renderWithProviders(<EditableTitle value="Click me" onSave={onSave} />);
        const editBtn = screen.getByRole('button', { name: /Edit title/i });
        fireEvent.click(editBtn);
        expect(screen.getByDisplayValue('Click me')).toBeInTheDocument();
    });

    it('check button saves the current draft', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(<EditableTitle value="Before" onSave={onSave} />);
        await userEvent.click(screen.getByText('Before'));
        const input = screen.getByDisplayValue('Before');
        await userEvent.clear(input);
        await userEvent.type(input, 'After');
        // Click the check icon button (first button in edit mode)
        const checkBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(checkBtn);
        await act(async () => { await Promise.resolve(); });
        expect(onSave).toHaveBeenCalledWith('After');
    });
});
