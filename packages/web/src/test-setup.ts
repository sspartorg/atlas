import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { setupServer } from 'msw/node';
import React from 'react';
import { _resetSseHubForTest } from './hooks/sse-hub.js';

// v8 coverage instrumentation triples async-wait time. Default waitFor
// timeout of 1s is enough under `pnpm test` but flakes under
// `pnpm test:coverage`, especially for lazy-loaded panels (Analytics
// cards, ProjectDetail tabs) whose data-branch text arrives after the
// dynamic import + render + msw response cycle. 10s absorbs the tail.
configure({ asyncUtilTimeout: 10_000 });

// lottie-web touches a real <canvas> at module-load (calls `fillStyle` on a
// CanvasRenderingContext2D). jsdom returns null for getContext('2d'), which
// throws "Cannot set properties of null (setting 'fillStyle')" and tanks every
// test file that transitively imports the header. Mock the React wrapper so
// the canvas path never runs in tests.
vi.mock('lottie-react', () => ({
    default: () => React.createElement('div', { 'data-testid': 'lottie-mock' }),
}));

// MSW intercepts every `fetch` call from the components/hooks under test.
// We start with NO handlers — each test registers what it expects to hit.
// Unhandled requests fail loudly so we never silently 404 a real request.
export const server = setupServer();

beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
    cleanup();
    server.resetHandlers();
    MockEventSource.reset();
    // sse-hub is module-scoped: clear its subscriber set and drop any
    // stale EventSource reference so the next test starts from a
    // fresh subscribe-opens-the-connection state.
    _resetSseHubForTest();
});

afterAll(() => {
    server.close();
});

// jsdom doesn't ship `EventSource`; provide a mock so any hook that opens one
// (useSSE, useRunOutputTail) doesn't crash at render. Tests can push synthetic
// events through `window.__pushSse(event)`.
class MockEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    url: string;
    readyState = 0;
    onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

    private static _instances: MockEventSource[] = [];
    private _listeners: Array<(ev: MessageEvent) => void> = [];

    constructor(url: string | URL) {
        this.url = url.toString();
        MockEventSource._instances.push(this);
    }

    static reset(): void {
        MockEventSource._instances.length = 0;
    }

    static pushToAll(event: object): void {
        const data = JSON.stringify(event);
        const msgEvent = new MessageEvent('message', { data });
        for (const inst of MockEventSource._instances) {
            for (const fn of inst._listeners) {
                fn(msgEvent);
            }
            if (inst.onmessage) {
                inst.onmessage.call(inst as unknown as EventSource, msgEvent);
            }
        }
    }

    close(): void {
        this.readyState = 2;
        MockEventSource._instances = MockEventSource._instances.filter((i) => i !== this);
    }

    addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
        if (type === 'message') {
            this._listeners.push(listener);
        }
    }

    removeEventListener(type: string, listener: (ev: MessageEvent) => void): void {
        if (type === 'message') {
            this._listeners = this._listeners.filter((fn) => fn !== listener);
        }
    }

    dispatchEvent(): boolean {
        return true;
    }
}

(window as Window & { __pushSse?: (e: object) => void }).__pushSse = (event: object) => {
    MockEventSource.pushToAll(event);
};

// Push a raw (pre-serialised) string directly to all MockEventSource instances.
// Needed to test malformed-JSON branches in useSSE without going through the
// JSON.stringify wrapper in pushToAll.
(window as Window & { __pushSseRaw?: (raw: string) => void }).__pushSseRaw = (raw: string) => {
    const msgEvent = new MessageEvent('message', { data: raw });
    const instances = (window.EventSource as unknown as { _instances: MockEventSource[] })._instances;
    for (const inst of instances) {
        // Mirror MockEventSource.pushToAll: call both _listeners and onmessage.
        const all = inst as unknown as { _listeners: Array<(ev: MessageEvent) => void>; onmessage: ((ev: MessageEvent) => void) | null };
        for (const fn of all._listeners) {
            fn(msgEvent);
        }
        if (all.onmessage) {
            all.onmessage.call(inst as unknown as EventSource, msgEvent);
        }
    }
};

vi.stubGlobal('EventSource', MockEventSource);

// jsdom doesn't implement matchMedia; MUI reads it for responsive breakpoints.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// `IntersectionObserver` / `ResizeObserver` aren't in jsdom either; some MUI
// components (e.g. AutoSizer-style ones) reference them at module load.
class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
        return [];
    }
}
vi.stubGlobal('IntersectionObserver', NoopObserver);
vi.stubGlobal('ResizeObserver', NoopObserver);

if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function () {};
}
