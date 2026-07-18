import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useIsMobile } from './useIsMobile.js';

describe('useIsMobile', () => {
    it('returns false when matchMedia matches=false (mocked default)', () => {
        const { result } = renderHook(() => useIsMobile(), { wrapper: makeWrapper() });
        expect(result.current).toBe(false);
    });

    it('returns true when matchMedia matches=true (mobile breakpoint)', () => {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: (query: string) => ({
                matches: true,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }),
        });
        const { result } = renderHook(() => useIsMobile(), { wrapper: makeWrapper() });
        expect(result.current).toBe(true);
    });

    it('restores to false when matchMedia matches=false after reset', () => {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: (query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }),
        });
        const { result } = renderHook(() => useIsMobile(), { wrapper: makeWrapper() });
        expect(result.current).toBe(false);
    });
});
