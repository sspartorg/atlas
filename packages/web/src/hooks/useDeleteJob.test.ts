import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDeleteJob } from './useDeleteJob.js';
import { _resetSseHubForTest } from './sse-hub.js';

class StubEventSource {
    static instances: StubEventSource[] = [];
    public closed = false;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
        StubEventSource.instances.push(this);
    }
    close(): void {
        this.closed = true;
    }
    fire(data: unknown): void {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
    fireRaw(raw: string): void {
        this.onmessage?.(new MessageEvent('message', { data: raw }));
    }
}

describe('useDeleteJob', () => {
    beforeEach(() => {
        StubEventSource.instances = [];
        vi.stubGlobal('EventSource', StubEventSource);
        _resetSseHubForTest();
    });
    afterEach(() => {
        _resetSseHubForTest();
        vi.unstubAllGlobals();
    });

    it('returns idle for null id', () => {
        const { result } = renderHook(() => useDeleteJob(null));
        expect(result.current.status).toBe('idle');
        expect(result.current.lines).toEqual([]);
        expect(result.current.mode).toBeNull();
    });

    it('starts running for an id', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        expect(result.current.status).toBe('running');
    });

    it('appends lines on delete_output', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_output', deleteId: 'd1', output: 'a' }));
        act(() => es.fire({ type: 'delete_output', deleteId: 'd1', output: 'b' }));
        expect(result.current.lines).toEqual(['a', 'b']);
    });

    it('completes with mode on delete_completed', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: 'd1', mode: 'purge' }));
        expect(result.current.status).toBe('ready');
        expect(result.current.mode).toBe('purge');
    });

    it('records error detail on delete_error', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'd1', errorDetail: 'nope' }));
        expect(result.current.status).toBe('error');
        expect(result.current.errorDetail).toBe('nope');
    });

    it('falls back to "Delete failed" when error has no detail', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'd1' }));
        expect(result.current.errorDetail).toBe('Delete failed');
    });

    it('completes with mode=null when delete_completed has no mode (payload.mode ?? null branch)', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        // Fire delete_completed without a mode property — ?? null fallback
        act(() => es.fire({ type: 'delete_completed', deleteId: 'd1' }));
        expect(result.current.status).toBe('ready');
        expect(result.current.mode).toBeNull();
    });

    it('ignores unknown event types (false branch of delete_error else-if)', () => {
        // An event with matching deleteId but an unknown type falls through all
        // three if/else-if clauses without changing state.
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_status', deleteId: 'd1', status: 'running' }));
        // State should remain 'running' (set on mount) and unchanged by unknown event
        expect(result.current.status).toBe('running');
        expect(result.current.lines).toEqual([]);
    });

    it('ignores events for a different deleteId', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_output', deleteId: 'other', output: 'x' }));
        expect(result.current.lines).toEqual([]);
    });

    it('swallows malformed JSON', () => {
        const { result } = renderHook(() => useDeleteJob('d1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fireRaw('not-json'));
        expect(result.current.lines).toEqual([]);
    });

    it('closes the shared EventSource when the last subscriber unmounts', () => {
        const { rerender } = renderHook(({ id }: { id: string | null }) => useDeleteJob(id), {
            initialProps: { id: 'd1' as string | null },
        });
        const es = StubEventSource.instances[0]!;
        rerender({ id: null });
        expect(es.closed).toBe(true);
    });
});
