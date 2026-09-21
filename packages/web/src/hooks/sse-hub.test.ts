import { describe, expect, it } from 'vitest';
import {
    getSSEState,
    subscribeSSEState,
    subscribeToEvents,
    type SSEConnectionState,
} from './sse-hub.js';

/**
 * The `window.__sseHub` diagnostic surface. It is the only way a Playwright
 * verification run (or a DevTools session) can check the single-EventSource
 * invariant this module exists for — the browser caps a tab at ~6 SSE
 * connections, and before the hub every hook opened its own. These tests pin
 * the shape and the numbers that surface reports, so a refactor that
 * re-introduces a per-hook EventSource fails here rather than in a flaky
 * browser run.
 */
interface SseHubDiagnostics {
    getSubscriberCount(): number;
    getStateListenerCount(): number;
    getState(): SSEConnectionState;
    getIsConnectionOpen(): boolean;
    getEventsReceived(): number;
    getRecentEventTypes(): string[];
}

function hub(): SseHubDiagnostics {
    const found = (window as Window & { __sseHub?: SseHubDiagnostics }).__sseHub;
    if (!found) throw new Error('window.__sseHub is not exposed');
    return found;
}

// test-setup's afterEach resets the hub's listener sets but deliberately not
// its lifetime event counters, so event-count assertions are relative.
const push = (event: object) =>
    (window as Window & { __pushSse?: (e: object) => void }).__pushSse?.(event);

function fireConnectionError(): void {
    const instances = (window.EventSource as unknown as { _instances: Array<{ onerror: (() => void) | null }> })
        ._instances;
    for (const inst of instances) inst.onerror?.();
}

describe('sse-hub diagnostics', () => {
    it('reports one connection shared by every subscriber, closed by the last', () => {
        expect(hub().getSubscriberCount()).toBe(0);
        expect(hub().getIsConnectionOpen()).toBe(false);

        const offA = subscribeToEvents(() => undefined);
        const offB = subscribeToEvents(() => undefined);
        // Two subscribers, still exactly one EventSource.
        expect(hub().getSubscriberCount()).toBe(2);
        expect(hub().getIsConnectionOpen()).toBe(true);

        offA();
        // The stream must survive while anyone is still listening — closing
        // it here would silently stop live updates for the other subscriber.
        expect(hub().getSubscriberCount()).toBe(1);
        expect(hub().getIsConnectionOpen()).toBe(true);

        offB();
        expect(hub().getSubscriberCount()).toBe(0);
        expect(hub().getIsConnectionOpen()).toBe(false);
    });

    it('ignores a repeated unsubscribe instead of dropping someone else', () => {
        // React 19 StrictMode runs effect cleanups twice; a non-idempotent
        // unsubscribe would take the ref count negative and tear the stream
        // down under the remaining subscriber.
        const offA = subscribeToEvents(() => undefined);
        subscribeToEvents(() => undefined);
        offA();
        offA();
        expect(hub().getSubscriberCount()).toBe(1);
        expect(hub().getIsConnectionOpen()).toBe(true);
    });

    it('reports the connection-state listener count', () => {
        expect(hub().getStateListenerCount()).toBe(0);
        const off = subscribeSSEState(() => undefined);
        expect(hub().getStateListenerCount()).toBe(1);
        off();
        expect(hub().getStateListenerCount()).toBe(0);
    });

    it('reports the same connection state useSSEStatus drives the topbar pill from', () => {
        subscribeToEvents(() => undefined);
        expect(hub().getState()).toBe('connecting');
        expect(hub().getState()).toBe(getSSEState());

        fireConnectionError();
        // EventSource reconnects on its own; the pill has to say so.
        expect(hub().getState()).toBe('reconnecting');
        expect(getSSEState()).toBe('reconnecting');
    });

    it('counts the events it fanned out and names the most recent ones', () => {
        const received: string[] = [];
        subscribeToEvents((e) => received.push(e.type));
        const before = hub().getEventsReceived();

        push({ type: 'agent_run_started', runId: 'r1' });
        push({ type: 'agent_run_finished', runId: 'r1' });

        expect(received).toEqual(['agent_run_started', 'agent_run_finished']);
        expect(hub().getEventsReceived()).toBe(before + 2);
        expect(hub().getRecentEventTypes().slice(-2)).toEqual([
            'agent_run_started',
            'agent_run_finished',
        ]);
    });

    it('keeps the recent-type ring bounded on a long-lived tab', () => {
        // A tab left open all day receives thousands of events; an unbounded
        // array here would be a slow leak in the diagnostic itself.
        subscribeToEvents(() => undefined);
        for (let i = 0; i < 60; i += 1) push({ type: `probe_${i}`, runId: 'r' });
        const recent = hub().getRecentEventTypes();
        expect(recent).toHaveLength(50);
        expect(recent[0]).toBe('probe_10');
        expect(recent.at(-1)).toBe('probe_59');
    });

    it('hands back a copy of the ring, not the live array', () => {
        // The diagnostic is read from a console/Playwright context; letting a
        // caller mutate hub state through the getter would corrupt it.
        subscribeToEvents(() => undefined);
        push({ type: 'agent_run_started', runId: 'r1' });
        const first = hub().getRecentEventTypes();
        first.length = 0;
        expect(hub().getRecentEventTypes().length).toBeGreaterThan(0);
    });
});
