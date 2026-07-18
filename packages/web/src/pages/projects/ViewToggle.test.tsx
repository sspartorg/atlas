import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ViewToggle } from './ViewToggle.js';

describe('Projects ViewToggle', () => {
    it('fires onChange when Table clicked', async () => {
        const onChange = vi.fn();
        renderWithProviders(<ViewToggle value="cards" onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: /Table/i }));
        expect(onChange).toHaveBeenCalledWith('table');
    });

    it('does NOT fire onChange when clicking the already-selected button (next=null guard)', async () => {
        // When value="cards" and Cards is clicked again, MUI passes next=null.
        // The guard `if (next) onChange(next)` should NOT call onChange.
        const onChange = vi.fn();
        renderWithProviders(<ViewToggle value="cards" onChange={onChange} />);
        // "Cards" is already selected — clicking it passes next=null → guard blocks the call
        await userEvent.click(screen.getByRole('button', { name: /Cards/i }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('renders Cards and Table toggle buttons', () => {
        renderWithProviders(<ViewToggle value="table" onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Cards/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });
});
