import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SecretRevealButton } from './SecretRevealButton.js';

// Batch-9 enterprise-secrets audit follow-up. Covers the four states of
// the reveal button (empty, masked, revealed, in-flight) plus the two
// non-obvious behaviours from the 2026-07-03 audit:
//   - onExpire is routed through a ref so parent re-renders don't reset
//     the countdown (finding SecretRevealButton.tsx:90).
//   - The interval fires onExpire exactly once and clears itself.

describe('SecretRevealButton', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders nothing when hasValue is false', () => {
        const { container } = render(
            <SecretRevealButton hasValue={false} onReveal={() => {}} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders masked dots + "Reveal" button when hasValue is true and no revealedValue', () => {
        render(<SecretRevealButton hasValue onReveal={() => {}} />);
        expect(screen.getByText(/•+/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reveal secret/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reveal secret/i })).not.toBeDisabled();
    });

    it('shows "Revealing…" and disables the button while isRevealing is true', () => {
        render(<SecretRevealButton hasValue onReveal={() => {}} isRevealing />);
        const btn = screen.getByRole('button', { name: /reveal secret/i });
        expect(btn).toBeDisabled();
        expect(btn.textContent).toMatch(/revealing/i);
    });

    it('fires onReveal when the masked-state button is clicked', () => {
        const onReveal = vi.fn();
        render(<SecretRevealButton hasValue onReveal={onReveal} />);
        fireEvent.click(screen.getByRole('button', { name: /reveal secret/i }));
        expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it('displays the plaintext + countdown when revealedValue is set', () => {
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="ghp_XXXXXXX"
                autoMaskSeconds={30}
            />,
        );
        expect(screen.getByText('ghp_XXXXXXX')).toBeInTheDocument();
        expect(screen.getByText(/auto-masks in 30s/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /copy revealed secret/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /re-mask secret/i })).toBeInTheDocument();
    });

    it('counts down each second and fires onExpire when reaching zero', () => {
        const onExpire = vi.fn();
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="sekret"
                onExpire={onExpire}
                autoMaskSeconds={3}
            />,
        );
        expect(screen.getByText(/auto-masks in 3s/i)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(screen.getByText(/auto-masks in 2s/i)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(screen.getByText(/auto-masks in 1s/i)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1000); });
        expect(screen.getByText(/auto-masks in 0s/i)).toBeInTheDocument();
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('does not fire onExpire more than once after countdown completes', () => {
        const onExpire = vi.fn();
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="sekret"
                onExpire={onExpire}
                autoMaskSeconds={1}
            />,
        );
        act(() => { vi.advanceTimersByTime(1000); });
        expect(onExpire).toHaveBeenCalledTimes(1);
        // Extra ticks after the interval self-clears must not re-fire.
        act(() => { vi.advanceTimersByTime(5000); });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('fires the LATEST onExpire even when the callback identity churns each render', () => {
        // 2026-07-03 audit finding: an earlier version listed `onExpire`
        // in the effect's dep array. Parents that pass inline closures
        // caused the effect to re-subscribe on every render, resetting
        // the countdown. Route through a ref so the latest closure fires
        // exactly once at t=autoMaskSeconds.
        const parentA = vi.fn();
        const parentB = vi.fn();
        const { rerender } = render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret"
                onExpire={parentA}
                autoMaskSeconds={3}
            />,
        );
        // Simulate a parent re-render that swaps to a fresh closure at
        // every tick; the countdown must still land in ~3s.
        act(() => { vi.advanceTimersByTime(1000); });
        rerender(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret"
                onExpire={parentB}
                autoMaskSeconds={3}
            />,
        );
        act(() => { vi.advanceTimersByTime(1000); });
        rerender(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret"
                onExpire={parentB}
                autoMaskSeconds={3}
            />,
        );
        act(() => { vi.advanceTimersByTime(1000); });
        // Countdown reached zero → the LATEST onExpire (parentB) fires,
        // not the original (parentA).
        expect(parentA).not.toHaveBeenCalled();
        expect(parentB).toHaveBeenCalledTimes(1);
    });

    it('clicking Re-mask now fires onExpire immediately', () => {
        const onExpire = vi.fn();
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="sekret"
                onExpire={onExpire}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /re-mask secret/i }));
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('clicking Copy writes the revealed value to the clipboard', async () => {
        vi.useRealTimers();
        const writeText = vi.fn().mockResolvedValue(undefined);
        // JSDOM ships without navigator.clipboard by default; install
        // a spyable stub for this test only.
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret-plaintext"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /copy revealed secret/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('secret-plaintext'));
    });

    it('swallows a clipboard-write rejection (best-effort — no throw)', async () => {
        vi.useRealTimers();
        const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret"
            />,
        );
        // Must not throw — the click resolves cleanly even when the
        // clipboard promise rejects.
        fireEvent.click(screen.getByRole('button', { name: /copy revealed secret/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalled());
    });

    it('copy is a no-op when there is no revealedValue (guard: masked state)', async () => {
        // Cannot click Copy in masked state (the button isn't rendered),
        // so this guards against a future refactor that keeps the copy
        // button visible with no value. Verify by rendering the visible
        // shape, unwinding revealedValue, then confirming the mask state
        // has no copy button at all.
        const { rerender } = render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="secret"
            />,
        );
        expect(screen.getByRole('button', { name: /copy revealed secret/i })).toBeInTheDocument();
        rerender(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue={null}
            />,
        );
        expect(screen.queryByRole('button', { name: /copy revealed secret/i })).not.toBeInTheDocument();
    });

    it('re-masks when revealedValue transitions from string to null', () => {
        const { rerender } = render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="plain"
            />,
        );
        expect(screen.getByText('plain')).toBeInTheDocument();
        rerender(
            <SecretRevealButton hasValue onReveal={() => {}} revealedValue={null} />,
        );
        expect(screen.queryByText('plain')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reveal secret/i })).toBeInTheDocument();
    });

    it('resets secondsLeft to autoMaskSeconds when re-revealed', () => {
        const { rerender } = render(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="v1"
                autoMaskSeconds={5}
            />,
        );
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByText(/auto-masks in 2s/i)).toBeInTheDocument();
        // Parent re-masks then re-reveals — countdown restarts from 5s.
        rerender(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue={null}
                autoMaskSeconds={5}
            />,
        );
        rerender(
            <SecretRevealButton
                hasValue
                onReveal={() => {}}
                revealedValue="v2"
                autoMaskSeconds={5}
            />,
        );
        expect(screen.getByText(/auto-masks in 5s/i)).toBeInTheDocument();
    });
});
