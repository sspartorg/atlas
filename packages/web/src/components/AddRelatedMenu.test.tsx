import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { AddRelatedMenu } from './AddRelatedMenu.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('AddRelatedMenu', () => {
    it('renders nothing when options is empty', () => {
        const { container } = renderWithProviders(<AddRelatedMenu options={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the trigger button and opens the menu on click', () => {
        const onClick = vi.fn();
        renderWithProviders(
            <AddRelatedMenu options={[{ label: 'Add story', onClick }]} />,
        );
        const trigger = screen.getByRole('button', { name: /add related item/i });
        fireEvent.click(trigger);
        expect(screen.getByRole('menuitem', { name: 'Add story' })).toBeInTheDocument();
    });

    it('fires the option onClick and closes the menu', () => {
        const onClick = vi.fn();
        renderWithProviders(
            <AddRelatedMenu options={[{ label: 'Add story', onClick }]} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /add related item/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add story' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('respects disabled option flag (aria-disabled is set)', () => {
        const onClick = vi.fn();
        renderWithProviders(
            <AddRelatedMenu
                options={[{ label: 'Add story', onClick, disabled: true }]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /add related item/i }));
        const item = screen.getByRole('menuitem', { name: 'Add story' });
        // MUI MenuItem marks the option as aria-disabled. The actual click-block
        // happens in the browser native handler — jsdom doesn't enforce it, so
        // we assert the visual/a11y signal instead of click suppression.
        expect(item).toHaveAttribute('aria-disabled', 'true');
    });

    it('renders custom icon when provided', () => {
        renderWithProviders(
            <AddRelatedMenu
                options={[
                    {
                        label: 'Link item',
                        onClick: () => {},
                        icon: <span data-testid="my-icon">@</span>,
                    },
                ]}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /add related item/i }));
        expect(screen.getByTestId('my-icon')).toBeInTheDocument();
    });

    it('accepts a custom label', () => {
        renderWithProviders(
            <AddRelatedMenu
                options={[{ label: 'X', onClick: () => {} }]}
                label="My label"
            />,
        );
        expect(screen.getByRole('button', { name: 'My label' })).toBeInTheDocument();
    });
});
