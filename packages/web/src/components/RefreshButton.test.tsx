import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { RefreshButton } from './RefreshButton.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('RefreshButton', () => {
    it('fires onRefresh when clicked', () => {
        const onRefresh = vi.fn();
        renderWithProviders(<RefreshButton onRefresh={onRefresh} isFetching={false} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('is disabled while fetching and does not fire onRefresh', () => {
        const onRefresh = vi.fn();
        renderWithProviders(<RefreshButton onRefresh={onRefresh} isFetching={true} />);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        fireEvent.click(btn);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('accepts a custom tooltip label and size=medium', () => {
        renderWithProviders(
            <RefreshButton
                onRefresh={() => {}}
                isFetching={false}
                tooltipLabel="Custom refresh"
                size="medium"
            />,
        );
        expect(screen.getByRole('button')).toBeInTheDocument();
    });
});
