import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCloneJob } from './useCloneJob.js';
import { _resetSseHubForTest } from './sse-hub.js';

/**
 * Stub for the browser's native `EventSource`. sse-hub sets handlers via
 * property assignment (`.onmessage = fn`), not `addEventListener`, so the
 * stub exposes those setters. `fire(data)` mimics the server pushing a
 * `message` event down the stream.
 */
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

describe('useCloneJob', () => {
    beforeEach(() => {
        StubEventSource.instances = [];
        vi.stubGlobal('EventSource', StubEventSource);
        // sse-hub is module-scoped: reset listeners + close any prior ES so
        // each test starts from a clean subscriber set.
        _resetSseHubForTest();
    });
    afterEach(() => {
        _resetSseHubForTest();
        vi.unstubAllGlobals();
    });

    it('returns idle when cloneId is null', () => {
        const { result } = renderHook(() => useCloneJob(null));
        expect(result.current.status).toBe('idle');
        expect(result.current.lines).toEqual([]);
    });

    it('transitions to cloning when an id is provided', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        expect(result.current.status).toBe('cloning');
    });

    it('appends lines on clone_output', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_output', cloneId: 'c1', output: 'first' }));
        act(() => es.fire({ type: 'clone_output', cloneId: 'c1', output: 'second' }));
        expect(result.current.lines).toEqual(['first', 'second']);
    });

    it('flips to ready on clone_completed with a project', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({
                type: 'clone_completed',
                cloneId: 'c1',
                project: { id: 'p1', name: 'p' },
            }),
        );
        expect(result.current.status).toBe('ready');
        expect(result.current.project).toEqual({ id: 'p1', name: 'p' });
    });

    it('flips to error on clone_error with detail', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_error', cloneId: 'c1', errorDetail: 'boom' }));
        expect(result.current.status).toBe('error');
        expect(result.current.errorDetail).toBe('boom');
    });

    it('falls back to "Clone failed" when error event has no detail', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_error', cloneId: 'c1' }));
        expect(result.current.errorDetail).toBe('Clone failed');
    });

    it('re-applies cloning status on clone_status event', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_status', cloneId: 'c1', status: 'cloning' }));
        expect(result.current.status).toBe('cloning');
    });

    it('ignores clone_status when status is not cloning (false branch of && condition)', () => {
        // `clone_status && payload.status === 'cloning'` — the AND's false branch
        // when status is some other value (e.g. 'ready' or 'starting').
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_status', cloneId: 'c1', status: 'ready' }));
        // Status unchanged — hook was set to 'cloning' on mount
        expect(result.current.status).toBe('cloning');
    });

    it('ignores events for a different cloneId', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'clone_output', cloneId: 'other', output: 'ignored' }));
        expect(result.current.lines).toEqual([]);
    });

    it('swallows malformed JSON without crashing', () => {
        const { result } = renderHook(() => useCloneJob('c1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fireRaw('not-json'));
        expect(result.current.lines).toEqual([]);
        expect(result.current.status).toBe('cloning');
    });

    it('closes the shared EventSource when the last subscriber unmounts', () => {
        // Ref-counted hub: the only subscriber unmounting brings the ES down.
        const { rerender } = renderHook(({ id }: { id: string | null }) => useCloneJob(id), {
            initialProps: { id: 'c1' as string | null },
        });
        const es = StubEventSource.instances[0]!;
        rerender({ id: null });
        expect(es.closed).toBe(true);
    });
});
