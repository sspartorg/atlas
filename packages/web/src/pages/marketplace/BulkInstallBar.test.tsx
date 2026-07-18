import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { BulkInstallBar } from './BulkInstallBar.js';

describe('BulkInstallBar', () => {
    it('renders nothing when count is 0', () => {
        const { container } = renderWithProviders(
            <BulkInstallBar count={0} busy={false} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders with count label when count > 0', () => {
        renderWithProviders(
            <BulkInstallBar count={3} busy={false} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('shows "Add selected" when not busy', () => {
        renderWithProviders(
            <BulkInstallBar count={2} busy={false} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        expect(screen.getByRole('button', { name: /Add selected/i })).toBeInTheDocument();
    });

    it('shows "Adding…" when busy', () => {
        renderWithProviders(
            <BulkInstallBar count={2} busy={true} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        expect(screen.getByRole('button', { name: /Adding/i })).toBeInTheDocument();
    });

    it('buttons disabled when busy', () => {
        renderWithProviders(
            <BulkInstallBar count={2} busy={true} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        const buttons = screen.getAllByRole('button');
        buttons.forEach(btn => {
            expect(btn).toBeDisabled();
        });
    });

    it('calls onClear when Clear is clicked', () => {
        const onClear = vi.fn();
        renderWithProviders(
            <BulkInstallBar count={1} busy={false} onClear={onClear} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        fireEvent.click(screen.getByRole('button', { name: /Clear/i }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('calls onSelectAll when Select all is clicked', () => {
        const onSelectAll = vi.fn();
        renderWithProviders(
            <BulkInstallBar count={1} busy={false} onClear={vi.fn()} onSelectAll={onSelectAll} onAdd={vi.fn()} />
        );
        fireEvent.click(screen.getByRole('button', { name: /Select all/i }));
        expect(onSelectAll).toHaveBeenCalledTimes(1);
    });

    it('calls onAdd when Add selected is clicked', () => {
        const onAdd = vi.fn();
        renderWithProviders(
            <BulkInstallBar count={1} busy={false} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={onAdd} />
        );
        fireEvent.click(screen.getByRole('button', { name: /Add selected/i }));
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('shows count = 1 correctly', () => {
        renderWithProviders(
            <BulkInstallBar count={1} busy={false} onClear={vi.fn()} onSelectAll={vi.fn()} onAdd={vi.fn()} />
        );
        expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
});
