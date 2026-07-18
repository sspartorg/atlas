import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThemeMode } from './useThemeMode.js';

const STORAGE_KEY = 'atlas.themeMode';

describe('useThemeMode', () => {
    beforeEach(() => {
        window.localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
        window.localStorage.removeItem(STORAGE_KEY);
    });

    it('defaults to light when nothing is persisted and matchMedia says light', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
    });

    it('reads persisted light mode from localStorage', () => {
        window.localStorage.setItem(STORAGE_KEY, 'light');
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
    });

    it('reads persisted dark mode from localStorage', () => {
        window.localStorage.setItem(STORAGE_KEY, 'dark');
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('dark');
    });

    it('setMode updates mode and persists to localStorage', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');

        act(() => {
            result.current.setMode('dark');
        });

        expect(result.current.mode).toBe('dark');
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('setMode from dark to light persists to localStorage', () => {
        window.localStorage.setItem(STORAGE_KEY, 'dark');
        const { result } = renderHook(() => useThemeMode());

        act(() => {
            result.current.setMode('light');
        });

        expect(result.current.mode).toBe('light');
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('cross-tab storage event updates mode', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: STORAGE_KEY,
                    newValue: 'dark',
                }),
            );
        });

        expect(result.current.mode).toBe('dark');
    });

    it('ignores storage events for unrelated keys', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'other.key',
                    newValue: 'dark',
                }),
            );
        });

        expect(result.current.mode).toBe('light');
    });

    it('defaults to dark when matchMedia.matches is true and nothing is stored', () => {
        // matchMedia already returns matches:false by default in test-setup.ts.
        // Override it for this test to return matches:true so readInitialMode() returns 'dark'.
        const origMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: (query: string) => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                onchange: null,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => true,
            }),
        });
        // No value in localStorage — readPersisted returns null → matchMedia dark branch
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('dark');
        Object.defineProperty(window, 'matchMedia', { writable: true, value: origMatchMedia });
    });

    it('falls back to light when localStorage.getItem throws (private-mode catch branch)', () => {
        // Simulate private browsing: localStorage.getItem throws SecurityError
        const origGetItem = window.localStorage.getItem.bind(window.localStorage);
        Object.defineProperty(window.localStorage, 'getItem', {
            configurable: true,
            value: () => { throw new Error('SecurityError: access denied'); },
        });
        // readPersisted() catches the error and returns null → readInitialMode falls through to 'light'
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
        Object.defineProperty(window.localStorage, 'getItem', {
            configurable: true,
            value: origGetItem,
        });
    });

    it('ignores storage events with invalid newValue (not light or dark)', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: STORAGE_KEY,
                    newValue: 'invalid-mode',
                }),
            );
        });
        // State unchanged — neither 'light' nor 'dark' so setModeState is not called
        expect(result.current.mode).toBe('light');
    });

    it('ignores storage events with null newValue (newValue=null branch)', () => {
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: STORAGE_KEY,
                    newValue: null,
                }),
            );
        });
        expect(result.current.mode).toBe('light');
    });

    it('falls back to light when matchMedia throws (matchMedia catch branch in readInitialMode)', () => {
        const origGetItem = window.localStorage.getItem.bind(window.localStorage);
        // Make localStorage return nothing (null) so persisted check fails
        window.localStorage.removeItem(STORAGE_KEY);
        const origMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: () => { throw new Error('matchMedia not supported'); },
        });
        // readInitialMode: no persisted value → matchMedia throws → falls through to 'light'
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
        Object.defineProperty(window, 'matchMedia', { writable: true, value: origMatchMedia });
        void origGetItem; // suppress unused warning
    });

    it('setMode still works when localStorage.setItem throws (quota catch branch)', () => {
        // Simulate full storage: setItem throws QuotaExceededError
        const origSetItem = window.localStorage.setItem.bind(window.localStorage);
        Object.defineProperty(window.localStorage, 'setItem', {
            configurable: true,
            value: () => { throw new Error('QuotaExceededError'); },
        });
        const { result } = renderHook(() => useThemeMode());
        // setMode catches the error but still updates in-memory state
        act(() => {
            result.current.setMode('dark');
        });
        // In-memory state updated even though localStorage threw
        expect(result.current.mode).toBe('dark');
        Object.defineProperty(window.localStorage, 'setItem', {
            configurable: true,
            value: origSetItem,
        });
    });

    it('falls back to light when matchMedia is not a function (window.matchMedia missing branch)', () => {
        // Simulate an environment where matchMedia is not a function.
        // The readInitialMode guard: `typeof window.matchMedia === 'function'` will be false.
        const origMatchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: undefined,
        });
        // No persisted value — falls through both guards and returns 'light'
        window.localStorage.removeItem(STORAGE_KEY);
        const { result } = renderHook(() => useThemeMode());
        expect(result.current.mode).toBe('light');
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: origMatchMedia,
        });
    });
});
