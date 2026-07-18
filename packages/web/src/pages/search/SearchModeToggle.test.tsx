import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SearchModeToggle } from './SearchModeToggle.js';

describe('SearchModeToggle', () => {
    it('fires onChange on click', async () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="filters" onChange={onChange} />);
        await userEvent.click(screen.getByText('Query'));
        expect(onChange).toHaveBeenCalledWith('query');
    });

    it('fires on Enter keyboard', async () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="filters" onChange={onChange} />);
        const queryBtn = screen.getByText('Query').closest('[role="button"]') as HTMLElement;
        queryBtn.focus();
        await userEvent.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalled();
    });

    it('fires on Space keyboard (onKeyDown Space branch)', async () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="filters" onChange={onChange} />);
        const queryBtn = screen.getByText('Query').closest('[role="button"]') as HTMLElement;
        queryBtn.focus();
        fireEvent.keyDown(queryBtn, { key: ' ' });
        expect(onChange).toHaveBeenCalledWith('query');
    });

    it('clicking Filters button when mode is query fires onChange with filters', async () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="query" onChange={onChange} />);
        await userEvent.click(screen.getByText('Filters'));
        expect(onChange).toHaveBeenCalledWith('filters');
    });

    it('clicking the already-active button still fires onChange', async () => {
        // active button is still clickable, still calls onChange
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="filters" onChange={onChange} />);
        await userEvent.click(screen.getByText('Filters'));
        expect(onChange).toHaveBeenCalledWith('filters');
    });

    it('ignores unrelated key (non-Enter/Space) in onKeyDown', () => {
        const onChange = vi.fn();
        renderWithProviders(<SearchModeToggle mode="filters" onChange={onChange} />);
        const queryBtn = screen.getByText('Query').closest('[role="button"]') as HTMLElement;
        fireEvent.keyDown(queryBtn, { key: 'Tab' });
        expect(onChange).not.toHaveBeenCalled();
    });
});
