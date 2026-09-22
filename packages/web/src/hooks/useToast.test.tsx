import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ToastProvider, useToast } from './useToast.js';

describe('useToast', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('throws when used outside ToastProvider', () => {
        expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    });

    it('shows and dismisses toasts', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastProvider>{children}</ToastProvider>
        );
        const { result } = renderHook(() => useToast(), { wrapper });
        expect(result.current.toasts).toEqual([]);
        act(() => result.current.show({ message: 'Saved' }));
        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0]?.message).toBe('Saved');
        const id = result.current.toasts[0]!.id;
        act(() => result.current.dismiss(id));
        expect(result.current.toasts).toEqual([]);
    });

    it('auto-dismisses after timeout', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastProvider>{children}</ToastProvider>
        );
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => result.current.show({ message: 'x', detail: 'y' }));
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(result.current.toasts).toEqual([]);
    });

    // A toast shown just before the provider goes away used to leave its 4s
    // auto-dismiss timer running. It fired into an unmounted tree, and under
    // jsdom teardown `window` is already gone — so it threw
    // `ReferenceError: window is not defined` from a bare `Timeout._onTimeout`,
    // failing whichever test happened to be running 4s later rather than the
    // one that showed the toast. Every test passed; the run still exited 1.
    it('cancels a pending auto-dismiss when the provider unmounts', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastProvider>{children}</ToastProvider>
        );
        const { result, unmount } = renderHook(() => useToast(), { wrapper });
        act(() => result.current.show({ message: 'leaks?' }));
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
        // Nothing is left to fire, so advancing past the dismiss window is a
        // no-op rather than a setState on an unmounted provider.
        expect(() => {
            act(() => {
                vi.advanceTimersByTime(10_000);
            });
        }).not.toThrow();
    });

    it('stores detail and action when provided', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastProvider>{children}</ToastProvider>
        );
        const { result } = renderHook(() => useToast(), { wrapper });
        const onClick = vi.fn();
        act(() =>
            result.current.show({ message: 'm', detail: 'd', action: { label: 'Undo', onClick } })
        );
        expect(result.current.toasts[0]?.detail).toBe('d');
        expect(result.current.toasts[0]?.action?.label).toBe('Undo');
    });
});
