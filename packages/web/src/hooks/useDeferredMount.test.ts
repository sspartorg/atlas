import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeferredMount } from './useDeferredMount.js';

describe('useDeferredMount', () => {
    it('returns true immediately so tab content mounts synchronously', () => {
        const { result } = renderHook(() => useDeferredMount());
        expect(result.current).toBe(true);
    });
});
