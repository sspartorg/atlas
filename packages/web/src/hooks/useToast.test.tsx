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

    it('stores detail and action when provided', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastProvider>{children}</ToastProvider>
        );
        const { result } = renderHook(() => useToast(), { wrapper });
        const onClick = vi.fn();
        act(() =>
            result.current.show({ message: 'm', detail: 'd', action: { label: 'Undo', onClick } }),
        );
        expect(result.current.toasts[0]?.detail).toBe('d');
        expect(result.current.toasts[0]?.action?.label).toBe('Undo');
    });
});
