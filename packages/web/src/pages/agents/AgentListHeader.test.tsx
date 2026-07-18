import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentListHeader } from './AgentListHeader.js';

describe('AgentListHeader', () => {
    it('renders the Agents h1', () => {
        renderWithProviders(
            <AgentListHeader installedCount={0} categoryCount={0} onAdd={vi.fn()} />,
        );
        expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy();
    });

    it('shows "0 installed" when installedCount is 0', () => {
        renderWithProviders(
            <AgentListHeader installedCount={0} categoryCount={0} onAdd={vi.fn()} />,
        );
        expect(screen.getByText('0 installed')).toBeTruthy();
    });

    it('shows count and categories when installedCount > 0', () => {
        renderWithProviders(
            <AgentListHeader installedCount={3} categoryCount={2} onAdd={vi.fn()} />,
        );
        expect(screen.getByText('3 installed · 2 categories')).toBeTruthy();
    });

    it('shows singular "category" when categoryCount is 1', () => {
        renderWithProviders(
            <AgentListHeader installedCount={2} categoryCount={1} onAdd={vi.fn()} />,
        );
        expect(screen.getByText('2 installed · 1 category')).toBeTruthy();
    });

    it('calls onAdd when Add Agent button is clicked', async () => {
        const onAdd = vi.fn();
        renderWithProviders(
            <AgentListHeader installedCount={0} categoryCount={0} onAdd={onAdd} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /add agent/i }));
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('does not render Import zip button when onImport is not provided', () => {
        renderWithProviders(
            <AgentListHeader installedCount={0} categoryCount={0} onAdd={vi.fn()} />,
        );
        expect(screen.queryByRole('button', { name: /import zip/i })).toBeNull();
    });

    it('renders Import zip button when onImport is provided', () => {
        renderWithProviders(
            <AgentListHeader
                installedCount={0}
                categoryCount={0}
                onAdd={vi.fn()}
                onImport={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /import zip/i })).toBeTruthy();
    });

    it('calls onImport when Import zip button is clicked', async () => {
        const onImport = vi.fn();
        renderWithProviders(
            <AgentListHeader
                installedCount={0}
                categoryCount={0}
                onAdd={vi.fn()}
                onImport={onImport}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /import zip/i }));
        expect(onImport).toHaveBeenCalledTimes(1);
    });
});
