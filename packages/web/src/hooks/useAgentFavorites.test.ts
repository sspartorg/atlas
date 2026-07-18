import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAgentFavorites } from './useAgentFavorites.js';

describe('useAgentFavorites', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });
    afterEach(() => {
        window.localStorage.clear();
    });

    it('starts empty when localStorage is empty', () => {
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual([]);
        expect(result.current.count).toBe(0);
        expect(result.current.isFav('a1')).toBe(false);
    });

    it('seeds from existing localStorage', () => {
        window.localStorage.setItem('atlas.agentFavorites', JSON.stringify(['a1']));
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual(['a1']);
        expect(result.current.isFav('a1')).toBe(true);
    });

    it('toggles items in and out', () => {
        const { result } = renderHook(() => useAgentFavorites());
        act(() => result.current.toggle('a1'));
        expect(result.current.ids).toEqual(['a1']);
        act(() => result.current.toggle('a1'));
        expect(result.current.ids).toEqual([]);
    });

    it('ignores non-array stored values', () => {
        window.localStorage.setItem('atlas.agentFavorites', JSON.stringify({ bad: true }));
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual([]);
    });

    it('seeds only string items from a mixed-type array — filters non-strings via filter(x is string)', () => {
        // readStored: Array.isArray(parsed) → filter keeps only strings
        // The mixed array [1, 'a1', null, 'a2', true] should yield ['a1', 'a2']
        window.localStorage.setItem('atlas.agentFavorites', JSON.stringify([1, 'a1', null, 'a2', true]));
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual(['a1', 'a2']);
    });

    it('toggle still updates in-memory when localStorage.setItem throws (persist catch branch)', () => {
        const origSetItem = window.localStorage.setItem.bind(window.localStorage);
        Object.defineProperty(window.localStorage, 'setItem', {
            configurable: true,
            value: () => { throw new Error('QuotaExceededError'); },
        });
        const { result } = renderHook(() => useAgentFavorites());
        act(() => result.current.toggle('a1'));
        // In-memory state updates even though setItem throws
        expect(result.current.ids).toEqual(['a1']);
        Object.defineProperty(window.localStorage, 'setItem', {
            configurable: true,
            value: origSetItem,
        });
    });

    it('readStored returns empty array when JSON.parse throws (malformed JSON catch branch)', () => {
        window.localStorage.setItem('atlas.agentFavorites', 'not valid json {{{');
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual([]);
    });

    it('responds to storage event with matching key (cross-tab sync)', () => {
        const { result } = renderHook(() => useAgentFavorites());
        expect(result.current.ids).toEqual([]);

        // Simulate another tab writing to the same key
        window.localStorage.setItem('atlas.agentFavorites', JSON.stringify(['a1', 'a2']));
        act(() => {
            const event = new StorageEvent('storage', {
                key: 'atlas.agentFavorites',
                newValue: JSON.stringify(['a1', 'a2']),
            });
            window.dispatchEvent(event);
        });
        expect(result.current.ids).toEqual(['a1', 'a2']);
    });

    it('ignores storage event with a different key (false branch of e.key === STORAGE_KEY)', () => {
        const { result } = renderHook(() => useAgentFavorites());
        act(() => result.current.toggle('a1'));
        expect(result.current.ids).toEqual(['a1']);

        // Storage event for an unrelated key should NOT change the ids
        act(() => {
            const event = new StorageEvent('storage', {
                key: 'some.other.key',
                newValue: '[]',
            });
            window.dispatchEvent(event);
        });
        // Still ['a1'] — the storage event was ignored
        expect(result.current.ids).toEqual(['a1']);
    });
});
