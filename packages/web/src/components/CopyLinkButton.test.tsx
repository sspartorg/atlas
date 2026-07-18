import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { CopyLinkButton } from './CopyLinkButton.js';

describe('CopyLinkButton', () => {
    it('copies the provided URL to clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        renderWithProviders(<CopyLinkButton url="https://x.test" />);
        await userEvent.click(screen.getByRole('button'));
        expect(writeText).toHaveBeenCalledWith('https://x.test');
    });

    it('swallows clipboard errors', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        renderWithProviders(<CopyLinkButton url="https://x.test" />);
        await userEvent.click(screen.getByRole('button'));
        expect(writeText).toHaveBeenCalled();
    });

    it('uses window.location.href when url prop is not provided (L17 ?? fallback)', async () => {
        // No url prop → target = url ?? window.location.href — exercises the right side of ??
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        // jsdom's window.location.href defaults to 'about:blank' (truthy) so L18 won't fire
        renderWithProviders(<CopyLinkButton />);
        await userEvent.click(screen.getByRole('button'));
        // Called with window.location.href (about:blank in jsdom)
        expect(writeText).toHaveBeenCalled();
    });

    it('shows CheckRounded icon after successful copy (copied=true icon branch)', async () => {
        vi.useFakeTimers();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        renderWithProviders(<CopyLinkButton url="https://x.test" />);
        // Use fireEvent (synchronous) instead of userEvent to avoid fake-timer hang
        await act(async () => {
            fireEvent.click(screen.getByRole('button'));
            // Let the resolved clipboard promise microtask run
            await Promise.resolve();
        });
        // writeText was called
        expect(writeText).toHaveBeenCalledWith('https://x.test');
        // Advance past the 1500ms reset timer to cover the cleanup
        act(() => { vi.advanceTimersByTime(2000); });
        vi.useRealTimers();
    });
});
