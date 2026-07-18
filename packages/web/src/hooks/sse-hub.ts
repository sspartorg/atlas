// One SSE stream per tab — shared across every hook that needs it.
//
// Before this module, `useSSE` + `useCloneJob` + `useDeleteJob` +
// `useRecloneJob` + `useRunOutputTail` each opened their own EventSource
// to /api/events. With the Owner watching a live run in one tab, cloning
// a project in another, and having two more tabs on Dashboard, the page
// hit the browser's per-origin SSE cap (~6 in Chromium/Firefox) and
// subsequent HTTP/1.1 requests blocked waiting for a socket slot.
//
// This module holds ONE EventSource per tab, ref-counted by the number of
// active subscribers. First `subscribeToEvents(...)` call opens the
// stream; the last `unsubscribe()` closes it. Every subscriber sees every
// parsed `SSEEvent` and filters on its own — cheap because per-event work
// is a `payload.cloneId !== cloneId` guard, not a fetch.
//
// The tab-wide connection state (`connecting` / `open` / `reconnecting`)
// also lives here so `useSSEStatus` can drive the topbar pill without
// prop-drilling.

import type { SSEEvent } from '@atlas/shared';

// ---------------------------------------------------------------------------
// Connection state store
// ---------------------------------------------------------------------------

export type SSEConnectionState = 'connecting' | 'open' | 'reconnecting';

let currentState: SSEConnectionState = 'connecting';
const stateListeners = new Set<() => void>();

function setSSEState(next: SSEConnectionState): void {
    if (currentState === next) return;
    currentState = next;
    for (const l of stateListeners) l();
}

/** Subscribe to connection-state changes (for useSyncExternalStore). */
export function subscribeSSEState(listener: () => void): () => void {
    stateListeners.add(listener);
    return () => {
        stateListeners.delete(listener);
    };
}

export function getSSEState(): SSEConnectionState {
    return currentState;
}

// ---------------------------------------------------------------------------
// Ref-counted EventSource + fanout to subscribers
// ---------------------------------------------------------------------------

/**
 * Called for every parsed SSE event. Second arg is the raw payload in case
 * a listener wants to log the untyped body (e.g. debug flag). Return value
 * is ignored — listeners are additive.
 */
export type SSEEventListener = (event: SSEEvent) => void;

const eventListeners = new Set<SSEEventListener>();

let es: EventSource | null = null;
let wasOpenOnce = false;

// Dev-only telemetry: total SSE events received on this tab since the
// hub was first opened. Read via `window.__sseHub.getEventsReceived()`
// during Playwright verification. Never referenced by production code.
let eventsReceivedCount = 0;
const recentEventTypes: string[] = [];

// Opt-in debug logging — toggle with `VITE_ATLAS_DEBUG_SSE=1` at
// dev-server start. When something downstream of SSE looks stuck (e.g.
// "Stop run" UI not refreshing), this is the fastest way to confirm
// whether the event actually reached the browser.
const debugSse = Boolean(import.meta.env['VITE_ATLAS_DEBUG_SSE']);

function ensureConnection(): void {
    if (es) return;
    setSSEState('connecting');
    const source = new EventSource('/api/events');
    es = source;

    source.onopen = () => {
        const wasReconnect = wasOpenOnce;
        wasOpenOnce = true;
        setSSEState('open');
        if (debugSse) console.debug('[sse-hub]', wasReconnect ? 'reconnect' : 'open');
    };

    source.onmessage = (e: MessageEvent) => {
        const raw = e.data as string;
        // Server sends heartbeats as SSE comment lines (`: heartbeat`) which
        // EventSource swallows; anything reaching onmessage MUST be JSON.
        let event: SSEEvent;
        try {
            event = JSON.parse(raw) as SSEEvent;
        } catch (err) {
            console.warn('[sse-hub] malformed event payload', { raw, err });
            return;
        }
        if (debugSse) {
            console.debug('[sse-hub]', event.type, event.runId ?? '', event);
        }
        eventsReceivedCount += 1;
        recentEventTypes.push(event.type);
        if (recentEventTypes.length > 50) recentEventTypes.shift();
        // Fan out to every subscriber. Copy the set into an array first so a
        // subscriber that unsubscribes during dispatch (e.g. useCloneJob
        // returning `status: 'ready'` and then unmounting) doesn't mutate
        // the iterator underneath us.
        const snapshot = Array.from(eventListeners);
        for (const listener of snapshot) {
            try {
                listener(event);
            } catch (err) {
                // A misbehaving listener must not tear down the whole hub —
                // other subscribers still need to receive the event.
                console.error('[sse-hub] listener threw; continuing', err);
            }
        }
    };

    source.onerror = () => {
        // EventSource auto-reconnects; surface the state so the topbar pill
        // can flip to "reconnecting" until `onopen` fires again.
        setSSEState('reconnecting');
    };
}

function teardownConnection(): void {
    if (!es) return;
    es.close();
    es = null;
    // Reset the was-open marker so a future subscribe starts a fresh
    // "initial open" cycle. `wasOpenOnce` gates the reconnect-time query
    // invalidation in useSSE; we want it re-armed if the app remounts.
    wasOpenOnce = false;
    setSSEState('connecting');
}

/**
 * Register a listener for every SSE event on this tab's stream. First
 * subscriber opens the underlying EventSource; last unsubscribe closes
 * it. Returned function is idempotent (calling twice unsubscribes once).
 */
export function subscribeToEvents(listener: SSEEventListener): () => void {
    eventListeners.add(listener);
    ensureConnection();
    let alive = true;
    return () => {
        if (!alive) return;
        alive = false;
        eventListeners.delete(listener);
        if (eventListeners.size === 0) {
            teardownConnection();
        }
    };
}

/**
 * Test-only hook. Vitest suites that touch these hooks share the module
 * scope; explicitly resetting between suites prevents cross-test bleed.
 * @internal
 */
export function _resetSseHubForTest(): void {
    eventListeners.clear();
    stateListeners.clear();
    teardownConnection();
    currentState = 'connecting';
}

// Development-mode diagnostic. Exposes the hub's live subscriber count
// and connection state on `window.__sseHub` so a browser DevTools
// session (or a Playwright verification run) can confirm the tab is
// using exactly ONE EventSource instead of N. Never referenced by
// production code; the property is dropped in prod builds when
// `import.meta.env.PROD` is true.
if (typeof window !== 'undefined' && !import.meta.env.PROD) {
    (window as Window & { __sseHub?: unknown }).__sseHub = {
        getSubscriberCount: (): number => eventListeners.size,
        getStateListenerCount: (): number => stateListeners.size,
        getState: (): SSEConnectionState => currentState,
        getIsConnectionOpen: (): boolean => es !== null,
        getEventsReceived: (): number => eventsReceivedCount,
        getRecentEventTypes: (): string[] => [...recentEventTypes],
    };
}
