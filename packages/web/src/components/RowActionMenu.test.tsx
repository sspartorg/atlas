import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { RowActionMenu } from './RowActionMenu.js';

describe('RowActionMenu', () => {
    it('opens the menu and fires the chosen item', async () => {
        const onClick = vi.fn();
        renderWithProviders(
            <RowActionMenu
                ariaLabel="Row actions"
                items={[{ label: 'Edit', onClick }]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Row actions' }));
        await userEvent.click(await screen.findByText('Edit'));
        expect(onClick).toHaveBeenCalled();
    });

    it('skips false/null/undefined items', async () => {
        renderWithProviders(
            <RowActionMenu
                ariaLabel="A"
                items={[false, null, undefined, { label: 'Real', onClick: () => undefined }]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'A' }));
        expect(await screen.findByText('Real')).toBeInTheDocument();
    });

    it('renders a divider above dividerAbove items', async () => {
        renderWithProviders(
            <RowActionMenu
                ariaLabel="A"
                items={[
                    { label: 'Top', onClick: () => undefined },
                    { label: 'Sep', onClick: () => undefined, dividerAbove: true },
                ]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'A' }));
        await screen.findByText('Sep');
        expect(document.querySelector('.MuiDivider-root')).toBeInTheDocument();
    });

    it('renders danger item with error color (danger branch in sx)', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <RowActionMenu
                ariaLabel="A"
                items={[{ label: 'Delete', onClick: onDelete, danger: true }]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'A' }));
        const deleteItem = await screen.findByText('Delete');
        expect(deleteItem).toBeInTheDocument();
        await userEvent.click(deleteItem);
        expect(onDelete).toHaveBeenCalled();
    });

    it('renders item with icon (item.icon truthy branch)', async () => {
        const onClick = vi.fn();
        const icon = <span data-testid="test-icon">X</span>;
        renderWithProviders(
            <RowActionMenu
                ariaLabel="A"
                items={[{ label: 'WithIcon', onClick, icon }]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'A' }));
        await screen.findByText('WithIcon');
        expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('renders danger item with icon (icon danger color branch)', async () => {
        const onClick = vi.fn();
        const icon = <span data-testid="danger-icon">!</span>;
        renderWithProviders(
            <RowActionMenu
                ariaLabel="A"
                items={[{ label: 'DangerWithIcon', onClick, icon, danger: true }]}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'A' }));
        await screen.findByText('DangerWithIcon');
        expect(screen.getByTestId('danger-icon')).toBeInTheDocument();
    });
});
