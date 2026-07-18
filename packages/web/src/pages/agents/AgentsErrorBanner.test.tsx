import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentsErrorBanner } from './AgentsErrorBanner.js';

describe('AgentsErrorBanner', () => {
    it("renders the error title \"Couldn't load agent statuses\"", () => {
        renderWithProviders(<AgentsErrorBanner onRetry={vi.fn()} />);
        expect(screen.getByText("Couldn't load agent statuses")).toBeTruthy();
    });

    it('renders the Retry button', () => {
        renderWithProviders(<AgentsErrorBanner onRetry={vi.fn()} />);
        expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    });

    it('calls onRetry when Retry is clicked', async () => {
        const onRetry = vi.fn();
        renderWithProviders(<AgentsErrorBanner onRetry={onRetry} />);
        await userEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
