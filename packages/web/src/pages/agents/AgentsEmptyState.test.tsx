import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentsEmptyState } from './AgentsEmptyState.js';

describe('AgentsEmptyState', () => {
    it('renders the "No agents installed" title', () => {
        renderWithProviders(<AgentsEmptyState onBrowse={vi.fn()} onCreate={vi.fn()} />);
        expect(screen.getByText('No agents installed')).toBeTruthy();
    });

    // Both routes out of an empty Agents page. The header's "Add Agent" is
    // hidden below md, so on a phone this empty state is the entire surface —
    // offering only the Marketplace left authoring your own agent unreachable.
    it('offers both Create new and Browse marketplace', () => {
        renderWithProviders(<AgentsEmptyState onBrowse={vi.fn()} onCreate={vi.fn()} />);
        expect(screen.getByRole('button', { name: /create new/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /browse marketplace/i })).toBeTruthy();
    });

    it('calls onBrowse when Browse marketplace is clicked', async () => {
        const onBrowse = vi.fn();
        const onCreate = vi.fn();
        renderWithProviders(<AgentsEmptyState onBrowse={onBrowse} onCreate={onCreate} />);
        await userEvent.click(screen.getByRole('button', { name: /browse marketplace/i }));
        expect(onBrowse).toHaveBeenCalledTimes(1);
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('calls onCreate when Create new is clicked', async () => {
        const onBrowse = vi.fn();
        const onCreate = vi.fn();
        renderWithProviders(<AgentsEmptyState onBrowse={onBrowse} onCreate={onCreate} />);
        await userEvent.click(screen.getByRole('button', { name: /create new/i }));
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(onBrowse).not.toHaveBeenCalled();
    });
});
