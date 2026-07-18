import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useTabParam } from './useTabParam.js';

const TABS = ['overview', 'epics', 'guardrails'] as const;
type Tab = (typeof TABS)[number];

function useHookWithLocation() {
    const [tab, setTab] = useTabParam<Tab>(TABS, 'overview');
    const { search } = useLocation();
    return { tab, setTab, search };
}

describe('useTabParam', () => {
    it('returns defaultTab when the URL has no ?tab= param', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/']),
        });
        expect(result.current.tab).toBe('overview');
        expect(result.current.search).toBe('');
    });

    it('reads the active tab from the URL on mount', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/?tab=guardrails']),
        });
        expect(result.current.tab).toBe('guardrails');
    });

    it('falls back to defaultTab when the URL value is not in the allowed set', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/?tab=bogus']),
        });
        expect(result.current.tab).toBe('overview');
        // URL is left alone on read — only setTab rewrites the param.
        expect(result.current.search).toBe('?tab=bogus');
    });

    it('setTab writes ?tab=<key> to the URL and reflects it on next render', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/']),
        });
        act(() => result.current.setTab('guardrails'));
        expect(result.current.search).toBe('?tab=guardrails');
        expect(result.current.tab).toBe('guardrails');
    });

    it('setTab(defaultTab) removes the tab param so the canonical URL stays clean', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/?tab=guardrails']),
        });
        act(() => result.current.setTab('overview'));
        expect(result.current.search).toBe('');
        expect(result.current.tab).toBe('overview');
    });

    it('preserves unrelated query params when setting the tab', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/?foo=bar']),
        });
        act(() => result.current.setTab('epics'));
        expect(result.current.search).toBe('?foo=bar&tab=epics');
    });

    it('setTab identity is stable across renders so memo bailout still works', () => {
        const { result, rerender } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/']),
        });
        const before = result.current.setTab;
        rerender();
        const after = result.current.setTab;
        expect(before).toBe(after);
    });

    it('handles repeated setTab calls to the same tab without throwing or desyncing', () => {
        const { result } = renderHook(() => useHookWithLocation(), {
            wrapper: makeWrapper(['/']),
        });
        act(() => result.current.setTab('guardrails'));
        act(() => result.current.setTab('guardrails'));
        expect(result.current.tab).toBe('guardrails');
        expect(result.current.search).toBe('?tab=guardrails');
    });
});
