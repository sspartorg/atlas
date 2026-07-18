import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunOutputTail } from './useRunOutputTail.js';
import type { SSEEvent } from '@atlas/shared';

function push(e: SSEEvent) {
    (window as Window & { __pushSse?: (e: object) => void }).__pushSse?.(e);
}

describe('useRunOutputTail', () => {
    beforeEach(() => {
        (globalThis as unknown as { EventSource: { reset?: () => void } }).EventSource.reset?.();
    });

    it('starts empty when no runId is given', () => {
        const { result } = renderHook(() => useRunOutputTail(null));
        expect(result.current.lines).toEqual([]);
        expect(result.current.isLive).toBe(false);
    });

    it('accumulates agent_output lines for the matching runId', () => {
        const { result } = renderHook(() => useRunOutputTail('R1'));
        expect(result.current.isLive).toBe(true);
        act(() => push({ type: 'agent_output', runId: 'R1', output: 'hello' }));
        act(() => push({ type: 'agent_output', runId: 'R1', output: 'world' }));
        expect(result.current.lines).toEqual(['hello', 'world']);
    });

    it('ignores events for a different runId', () => {
        const { result } = renderHook(() => useRunOutputTail('R1'));
        act(() => push({ type: 'agent_output', runId: 'R2', output: 'nope' }));
        expect(result.current.lines).toEqual([]);
    });

    it('resets the buffer when runId changes', () => {
        const { result, rerender } = renderHook(
            ({ id }: { id: string | null }) => useRunOutputTail(id),
            { initialProps: { id: 'R1' as string | null } },
        );
        act(() => push({ type: 'agent_output', runId: 'R1', output: 'a' }));
        expect(result.current.lines).toEqual(['a']);
        rerender({ id: 'R2' });
        expect(result.current.lines).toEqual([]);
        act(() => push({ type: 'agent_output', runId: 'R2', output: 'b' }));
        expect(result.current.lines).toEqual(['b']);
    });

    it('flips isLive false on run_completed for matching runId', () => {
        const { result } = renderHook(() => useRunOutputTail('R1'));
        expect(result.current.isLive).toBe(true);
        act(() => push({ type: 'run_completed', runId: 'R1' }));
        expect(result.current.isLive).toBe(false);
    });

    it('flips isLive false on run_error for matching runId', () => {
        const { result } = renderHook(() => useRunOutputTail('R1'));
        act(() => push({ type: 'run_error', runId: 'R1' }));
        expect(result.current.isLive).toBe(false);
    });

    it('does not update state after unmount', () => {
        const { result, unmount } = renderHook(() => useRunOutputTail('R1'));
        act(() => push({ type: 'agent_output', runId: 'R1', output: 'before' } as SSEEvent));
        expect(result.current.lines).toEqual(['before']);
        unmount();
        act(() => push({ type: 'agent_output', runId: 'R1', output: 'ghost' } as SSEEvent));
        // result.current is frozen at the last rendered value
        expect(result.current.lines).toEqual(['before']);
    });
});
