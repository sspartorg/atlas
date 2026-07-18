import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecloneJob } from './useRecloneJob.js';
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

describe('useRecloneJob', () => {
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
        const { result } = renderHook(() => useRecloneJob(null));
        expect(result.current.status).toBe('idle');
    });

    it('returns running when an id is set', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        expect(result.current.status).toBe('running');
    });

    it('appends lines on reclone_output', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_output', recloneId: 'r1', output: 'one' }));
        act(() => es.fire({ type: 'reclone_output', recloneId: 'r1', output: 'two' }));
        expect(result.current.lines).toEqual(['one', 'two']);
    });

    it('completes with stashPath on reclone_completed', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'reclone_completed', recloneId: 'r1', stashPath: '/tmp/stash' }),
        );
        expect(result.current.status).toBe('ready');
        expect(result.current.stashPath).toBe('/tmp/stash');
    });

    it('records error detail on reclone_error', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_error', recloneId: 'r1', errorDetail: 'fail' }));
        expect(result.current.status).toBe('error');
        expect(result.current.errorDetail).toBe('fail');
    });

    it('falls back to "Re-clone failed" when error has no detail', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_error', recloneId: 'r1' }));
        expect(result.current.errorDetail).toBe('Re-clone failed');
    });

    it('completes with stashPath=null when reclone_completed has no stashPath (payload.stashPath ?? null branch)', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_completed', recloneId: 'r1' }));
        expect(result.current.status).toBe('ready');
        expect(result.current.stashPath).toBeNull();
    });

    it('ignores unknown event types (false branch of reclone_error else-if)', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_status', recloneId: 'r1', status: 'running' }));
        expect(result.current.status).toBe('running');
        expect(result.current.lines).toEqual([]);
    });

    it('ignores events for a different recloneId', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'reclone_output', recloneId: 'other', output: 'x' }));
        expect(result.current.lines).toEqual([]);
    });

    it('swallows malformed JSON', () => {
        const { result } = renderHook(() => useRecloneJob('r1'));
        const es = StubEventSource.instances[0]!;
        act(() => es.fireRaw('bogus'));
        expect(result.current.lines).toEqual([]);
    });

    it('closes the shared EventSource when the last subscriber unmounts', () => {
        const { rerender } = renderHook(({ id }: { id: string | null }) => useRecloneJob(id), {
            initialProps: { id: 'r1' as string | null },
        });
        const es = StubEventSource.instances[0]!;
        rerender({ id: null });
        expect(es.closed).toBe(true);
    });
});
