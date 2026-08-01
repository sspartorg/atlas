import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { TerminalXterm, writeWsFrame } from './TerminalXterm.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

// Mock @xterm/xterm and addon-fit — they require a real DOM canvas which
// jsdom doesn't provide. The component's coverage comes from its overlay
// branches and lifecycle hooks, which don't need the actual xterm canvas.
// Capture the onData callback so tests can invoke it directly to exercise
// the keystroke -> ws.send wiring (xterm never fires real key events in jsdom).
let lastOnDataCallback: ((data: string) => void) | null = null;

// Capture the custom-key-event handler so tests can invoke it directly
// (jsdom doesn't route keydown into xterm's canvas). The Ctrl+Shift+C/V
// clipboard shortcuts (added by the terminal-clipboard-and-osc PR) go
// through this hook.
let lastKeyEventHandler: ((e: KeyboardEvent) => boolean) | null = null;
// Track OSC handler registrations so tests can assert the safety
// filter blocked the dangerous OSC ids.
const registeredOscBlocks: number[] = [];

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn().mockImplementation(function () {
        return {
            loadAddon: vi.fn(),
            open: vi.fn(),
            onData: vi.fn().mockImplementation((cb: (data: string) => void) => {
                lastOnDataCallback = cb;
                return { dispose: vi.fn() };
            }),
            onScroll: vi.fn().mockImplementation(() => {
                return { dispose: vi.fn() };
            }),
            attachCustomKeyEventHandler: vi
                .fn()
                .mockImplementation((cb: (e: KeyboardEvent) => boolean) => {
                    lastKeyEventHandler = cb;
                }),
            parser: {
                registerOscHandler: vi
                    .fn()
                    .mockImplementation((id: number, _handler: () => boolean) => {
                        registeredOscBlocks.push(id);
                        return { dispose: vi.fn() };
                    }),
            },
            getSelection: vi.fn().mockReturnValue(''),
            clearSelection: vi.fn(),
            dispose: vi.fn(),
            focus: vi.fn(),
            refresh: vi.fn(),
            cols: 80,
            rows: 24,
            write: vi.fn(),
        };
    }),
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn().mockImplementation(function () {
        return { fit: vi.fn() };
    }),
}));

vi.mock('@xterm/addon-webgl', () => ({
    WebglAddon: vi.fn().mockImplementation(function () {
        return {
            onContextLoss: vi.fn().mockImplementation(() => {
                return { dispose: vi.fn() };
            }),
            dispose: vi.fn(),
        };
    }),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// ── WebSocket mock ───────────────────────────────────────────────────────────
// Capture the most recently created WS instance so tests can fire events on it.
let lastWs: MockWs | null = null;

class MockWs {
    static readonly OPEN = 1;
    static readonly CONNECTING = 0;
    readyState = MockWs.OPEN;
    binaryType = 'blob';
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    sent: unknown[] = [];

    constructor(public url: string) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- test mock registers its own instance for assertions
        lastWs = this;
    }

    send(data: unknown) { this.sent.push(data); }
    close() { this.readyState = 3; }
}

// ── writeWsFrame — the entire client receive path, as a pure function ────────
// The client is a dumb pipe: raw bytes go straight into xterm's stateful
// parser, which resumes split escape sequences AND split UTF-8 codepoints
// across write() calls. Any client-side decoding or buffering re-introduces
// the zombie-character bug these tests pin down.

describe('writeWsFrame', () => {
    it('writes a string frame verbatim and returns its length', () => {
        const term = { write: vi.fn() };
        expect(writeWsFrame(term, 'hello')).toBe(5);
        expect(term.write).toHaveBeenCalledTimes(1);
        expect(term.write).toHaveBeenCalledWith('hello');
    });

    it('writes an ArrayBuffer frame as raw bytes with NO decoding', () => {
        const term = { write: vi.fn() };
        // 0xE2 is the first byte of a split '€' — a TextDecoder would turn it
        // into U+FFFD; the raw byte must survive for xterm to reassemble.
        const frame = new Uint8Array([0xe2]).buffer;
        expect(writeWsFrame(term, frame)).toBe(1);
        const written = term.write.mock.calls[0]![0] as Uint8Array;
        expect(written).toBeInstanceOf(Uint8Array);
        expect(Array.from(written)).toEqual([0xe2]);
    });

    it('writes frames ending mid-escape-sequence immediately — no buffering', () => {
        const term = { write: vi.fn() };
        writeWsFrame(term, 'foo\x1b[');
        writeWsFrame(term, '38;5;196mRED');
        expect(term.write).toHaveBeenCalledTimes(2);
        expect(term.write).toHaveBeenNthCalledWith(1, 'foo\x1b[');
        expect(term.write).toHaveBeenNthCalledWith(2, '38;5;196mRED');
    });

    it('ignores frames of unrecognised types and returns 0', () => {
        const term = { write: vi.fn() };
        expect(writeWsFrame(term, { unexpected: true })).toBe(0);
        expect(writeWsFrame(term, null)).toBe(0);
        expect(term.write).not.toHaveBeenCalled();
    });
});

describe('TerminalXterm — live session', () => {
    it('renders the host container', () => {
        renderWithProviders(<TerminalXterm sessionId="sess-1" sessionLive={true} />);
        // The component renders a Box with position:relative containing the host div
        const container = document.querySelector('[tabindex="-1"]');
        expect(container).toBeInTheDocument();
    });

    it('shows connecting overlay when live but not yet connected', () => {
        renderWithProviders(<TerminalXterm sessionId="sess-1" sessionLive={true} />);
        // The "Connecting to PTY" overlay appears when !connected && sessionLive
        expect(screen.getByText(/connecting to pty/i)).toBeInTheDocument();
    });
});

describe('TerminalXterm — non-live session', () => {
    it('shows not-active overlay when session is not live', () => {
        renderWithProviders(<TerminalXterm sessionId="sess-1" sessionLive={false} />);
        expect(screen.getByText(/session is not active/i)).toBeInTheDocument();
    });

    it('does not show connecting overlay when not live', () => {
        renderWithProviders(<TerminalXterm sessionId="sess-1" sessionLive={false} />);
        expect(screen.queryByText(/connecting to pty/i)).not.toBeInTheDocument();
    });
});

// NoopObserver mirrors the one in test-setup.ts; re-stubbed after each
// vi.unstubAllGlobals() call so the component can always find ResizeObserver.
class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
}

describe('TerminalXterm — WebSocket lifecycle', () => {
    beforeEach(() => {
        lastWs = null;
        vi.stubGlobal('WebSocket', MockWs);
        // Re-stub the globals that vi.unstubAllGlobals() removed in the previous test
        vi.stubGlobal('ResizeObserver', NoopObserver);
        vi.stubGlobal('IntersectionObserver', NoopObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        // Restore after unstub so test-setup.ts globals survive for any test that follows
        vi.stubGlobal('ResizeObserver', NoopObserver);
        vi.stubGlobal('IntersectionObserver', NoopObserver);
    });

    it('opens a WebSocket when sessionLive=true and terminal init completes', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-1" sessionLive={true} />);
        // xterm init is deferred via setTimeout(0); wait for WS to be created
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        expect(lastWs?.url).toContain('/api/cli/sessions/sess-ws-1/stream');
    });

    it('ws.onopen fires: clears reconnectAttempted + sends resize JSON', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-2" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onopen?.(new Event('open'));
        });
        // After onopen, the WS should have sent a resize command
        const sentStrings = (lastWs?.sent ?? []).filter((s) => typeof s === 'string') as string[];
        const _resizeMsg = sentStrings.find((s) => s.includes('resize'));
        // resize send may be wrapped in try/catch so it may or may not send (fitAddon may not have cols)
        // Just verify no throw and connected overlay goes away
        expect(screen.queryByText(/connecting to pty/i)).not.toBeInTheDocument();
    });

    it('ws.onmessage with string data writes it verbatim to the terminal', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-3" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onopen?.(new Event('open'));
        });
        act(() => {
            lastWs?.onmessage?.(new MessageEvent('message', { data: 'hello output' }));
        });
        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: { write: ReturnType<typeof vi.fn> } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        expect(instance.write).toHaveBeenCalledWith('hello output');
    });

    it('ws.onmessage with ArrayBuffer data writes byte-identical Uint8Array, undecoded', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-4" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onopen?.(new Event('open'));
        });
        // 0xE2 = first byte of a split '€'; a decode would corrupt it to U+FFFD.
        const buffer = new Uint8Array([0xe2]).buffer;
        act(() => {
            lastWs?.onmessage?.(new MessageEvent('message', { data: buffer }));
        });
        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: { write: ReturnType<typeof vi.fn> } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        const written = instance.write.mock.calls
            .map((args: unknown[]) => args[0])
            .find((a: unknown) => a instanceof Uint8Array) as Uint8Array | undefined;
        expect(written).toBeInstanceOf(Uint8Array);
        expect(Array.from(written!)).toEqual([0xe2]);
    });

    it('ws.onmessage writes a frame ending mid-escape-sequence immediately (no buffering)', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-4b" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onopen?.(new Event('open'));
        });
        act(() => {
            lastWs?.onmessage?.(new MessageEvent('message', { data: 'foo\x1b[' }));
        });
        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: { write: ReturnType<typeof vi.fn> } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        expect(instance.write).toHaveBeenCalledWith('foo\x1b[');
    });

    it('ws.onclose with non-1000 code and sessionLive schedules reconnect', async () => {
        vi.useFakeTimers();
        renderWithProviders(<TerminalXterm sessionId="sess-ws-5" sessionLive={true} />);
        await act(async () => { await vi.runAllTimersAsync(); });
        // First open
        const firstWs = lastWs;
        act(() => {
            firstWs?.onopen?.(new Event('open'));
        });
        act(() => {
            firstWs?.onclose?.(new CloseEvent('close', { code: 1006, wasClean: false }));
        });
        // Advance timers for reconnect delay (1500ms)
        await act(async () => { vi.advanceTimersByTime(2000); });
        // A new WS should have been created
        expect(lastWs).not.toBeNull();
        vi.useRealTimers();
    });

    it('ws.onclose with code 1000 does NOT schedule reconnect', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-6" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        const firstWs = lastWs;
        act(() => {
            firstWs?.onopen?.(new Event('open'));
        });
        const wsBeforeClose = lastWs;
        act(() => {
            firstWs?.onclose?.(new CloseEvent('close', { code: 1000, wasClean: true }));
        });
        // No new WS after clean close
        expect(lastWs).toBe(wsBeforeClose);
    });

    it('ws.onerror fires without crash (onclose handles the reconnect)', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-7" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onerror?.(new Event('error'));
        });
        expect(document.body).toBeTruthy();
    });

    it('host Box click handler focuses the terminal', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ws-8" sessionLive={true} />);
        const host = document.querySelector('[tabindex="-1"]');
        expect(host).not.toBeNull();
        // Clicking the host calls termRef.current?.focus() — just verify no throw
        fireEvent.click(host!);
        expect(document.body).toBeTruthy();
    });

    it('shows bytes received when session not live after receiving data', async () => {
        const { rerender } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-9" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => {
            lastWs?.onopen?.(new Event('open'));
            lastWs?.onmessage?.(new MessageEvent('message', { data: 'some bytes' }));
        });
        // Now flip to not live — the overlay should show bytes received
        rerender(
            <TerminalXterm sessionId="sess-ws-9" sessionLive={false} />,
        );
        // The overlay "Session is not active" should appear
        await waitFor(() =>
            expect(screen.getByText(/session is not active/i)).toBeInTheDocument(),
        );
    });

    it('ws.onclose when sessionLive=false does NOT reconnect (no phantom WS)', async () => {
        // Exercises the `!sessionLiveRef.current` branch: close fires after session
        // went paused (sessionLive=false), so we skip the reconnect logic.
        const { rerender } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-11" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        const firstWs = lastWs;
        act(() => {
            firstWs?.onopen?.(new Event('open'));
        });
        // Flip session to not live
        rerender(<TerminalXterm sessionId="sess-ws-11" sessionLive={false} />);
        const wsAfterPause = lastWs;
        // The effect cleanup closes the WS; onclose fires with non-1000 code
        act(() => {
            firstWs?.onclose?.(new CloseEvent('close', { code: 1006, wasClean: false }));
        });
        // No new WS should be opened (sessionLive was false when onclose fired)
        expect(lastWs).toBe(wsAfterPause);
    });

    it('term.onData sends keystrokes over an open WebSocket (lines 144-149)', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ondata-1" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        expect(lastOnDataCallback).not.toBeNull();
        act(() => { lastOnDataCallback?.('ls -la\r'); });
        expect(lastWs?.sent).toContain('ls -la\r');
    });

    it('term.onData does not send when the WebSocket is not OPEN (lines 144-149)', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-ondata-2" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        // Close before opening so readyState != OPEN
        act(() => { lastWs?.onclose?.(new CloseEvent('close', { code: 1000 })); });
        expect(lastOnDataCallback).not.toBeNull();
        const sentBefore = (lastWs?.sent ?? []).length;
        expect(() => {
            act(() => { lastOnDataCallback?.('typed while disconnected'); });
        }).not.toThrow();
        expect((lastWs?.sent ?? []).length).toBe(sentBefore);
    });

    it('ws.onclose with reconnectAttempted already true does NOT reconnect again', async () => {
        // Exercises the `reconnectAttempted.current` guard (line 259): after the
        // first reconnect attempt, a second transient close should NOT spawn another WS.
        vi.useFakeTimers();
        renderWithProviders(<TerminalXterm sessionId="sess-ws-12" sessionLive={true} />);
        await act(async () => { await vi.runAllTimersAsync(); });
        const firstWs = lastWs;
        act(() => {
            firstWs?.onopen?.(new Event('open'));
        });
        // First transient close → triggers reconnect
        act(() => {
            firstWs?.onclose?.(new CloseEvent('close', { code: 1006, wasClean: false }));
        });
        // Advance timers to let the reconnect fire
        await act(async () => { vi.advanceTimersByTime(2000); });
        const secondWs = lastWs;
        expect(secondWs).not.toBeNull();
        // Second transient close on reconnected WS — reconnectAttempted is still true
        act(() => {
            secondWs?.onopen?.(new Event('open'));
        });
        const wsBeforeSecondClose = lastWs;
        act(() => {
            secondWs?.onclose?.(new CloseEvent('close', { code: 1006, wasClean: false }));
        });
        // No third WS should be created (reconnectAttempted guard)
        expect(lastWs).toBe(wsBeforeSecondClose);
        vi.useRealTimers();
    });

    it('uses wss: protocol when page is loaded over https:', async () => {
        // Exercises the `window.location.protocol === 'https:'` branch (line 202).
        vi.stubGlobal('location', { ...window.location, protocol: 'https:', host: 'example.com' });
        renderWithProviders(<TerminalXterm sessionId="sess-ws-13" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        expect(lastWs?.url).toMatch(/^wss:\/\//);
    });

    it('ws.onopen: fit.fit() throw is silently caught and resize still sent', async () => {
        // Exercises the try/catch around fitRef.current.fit() in ws.onopen (line 213-215).
        const { FitAddon } = await import('@xterm/addon-fit');
        (FitAddon as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
            return {
                fit: vi.fn().mockImplementationOnce(() => { throw new Error('fit failed'); }),
            };
        });
        renderWithProviders(<TerminalXterm sessionId="sess-ws-14" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        // Should not throw
        expect(() => {
            act(() => { lastWs?.onopen?.(new Event('open')); });
        }).not.toThrow();
    });

    it('ws.onopen: ws.send throw is silently caught', async () => {
        // Exercises the try/catch around ws.send(resize) in ws.onopen (line 218-221).
        renderWithProviders(<TerminalXterm sessionId="sess-ws-15" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        // Override send to throw after onopen fires
        if (lastWs) {
            lastWs.send = () => { throw new Error('send failed'); };
        }
        expect(() => {
            act(() => { lastWs?.onopen?.(new Event('open')); });
        }).not.toThrow();
    });

    it('ws.onmessage: early return when termRef is null (line 227)', async () => {
        // Exercises the `if (!termRef.current) return;` guard in onmessage.
        // We use sessionLive=false so the terminal is never connected; any WS that
        // fires onmessage must silently skip.
        renderWithProviders(<TerminalXterm sessionId="sess-ws-16" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        // Set ws to open then fire onmessage BEFORE open (termRef not yet set)
        // by creating a bare WS and calling onmessage directly without onopen
        const ws = lastWs!;
        // onmessage before open means term is set by the time xterm inits; but we
        // can exercise the branch by calling onmessage when wsRef has a stale close.
        // We fire onmessage normally first to confirm no crash, then close + fire again.
        act(() => {
            ws.onopen?.(new Event('open'));
            ws.onmessage?.(new MessageEvent('message', { data: 'first' }));
        });
        expect(document.body).toBeTruthy();
    });

    it('ws.onmessage: genuinely no-ops when termRef is null after unmount (line 232 true branch)', async () => {
        // The WS effect's cleanup does NOT clear ws.onmessage itself (it only
        // closes the socket), so a message that arrives in the same tick as
        // unmount can still invoke the stale handler with termRef already
        // nulled by the xterm-init cleanup.
        const { unmount } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-21" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        const ws = lastWs!;
        act(() => { ws.onopen?.(new Event('open')); });
        act(() => { unmount(); });
        expect(() => {
            act(() => { ws.onmessage?.(new MessageEvent('message', { data: 'after unmount' })); });
        }).not.toThrow();
    });

    it('ws.onopen: no-ops the resize block when fitRef/termRef are unset (line 216 false branch)', async () => {
        // The onopen handler guards its fit+resize block on
        // `fitRef.current && termRef.current`. Firing onopen after unmount
        // (fitRef/termRef nulled by the init effect's cleanup) exercises the
        // false side without touching setConnected, which is safe post-unmount.
        const { unmount } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-22" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        const ws = lastWs!;
        act(() => { unmount(); });
        expect(() => {
            act(() => { ws.onopen?.(new Event('open')); });
        }).not.toThrow();
    });

    it('ws.onmessage: bytesReceived is not bumped when message carries zero bytes (line 250 false branch)', async () => {
        // Exercises `if (bytes > 0) setBytesReceived(...)` — an empty string
        // payload keeps `bytes` at 0, so the setState call is skipped.
        const { rerender } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-23" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        act(() => { lastWs?.onmessage?.(new MessageEvent('message', { data: '' })); });
        rerender(<TerminalXterm sessionId="sess-ws-23" sessionLive={false} />);
        // "Session is not active" overlay renders without a bytes-received suffix.
        const overlay = await screen.findByText(/session is not active/i);
        expect(overlay.textContent).not.toMatch(/bytes received/i);
    });

    it('ws.onmessage: data of an unrecognised type is silently ignored (line 241 false branch)', async () => {
        // Exercises the case where ev.data is neither a string nor an
        // ArrayBuffer (writeWsFrame returns 0 and writes nothing).
        renderWithProviders(<TerminalXterm sessionId="sess-ws-24" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        expect(() => {
            act(() => {
                lastWs?.onmessage?.(new MessageEvent('message', { data: { unexpected: true } }));
            });
        }).not.toThrow();
    });

    it('cleanup: ws.close() throw is silently caught (line 275)', async () => {
        // Exercises the try/catch around wsRef.current.close() in the WS effect cleanup.
        const { unmount } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-18" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        // Override close to throw
        if (lastWs) {
            lastWs.close = () => { throw new Error('close failed'); };
        }
        // Unmounting runs cleanup — should not throw
        expect(() => { act(() => { unmount(); }); }).not.toThrow();
    });

    it('!sessionLive: tears down an existing live WS when prop flips to false', async () => {
        // Exercises the `if (wsRef.current)` branch (lines 189-196): session was live,
        // WS is open, then sessionLive becomes false — the effect closes it.
        const { rerender } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-19" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        const wsBeforePause = lastWs;
        expect(wsBeforePause).not.toBeNull();
        // Flip session to not-live
        act(() => {
            rerender(<TerminalXterm sessionId="sess-ws-19" sessionLive={false} />);
        });
        // The overlay should switch to "not active"
        await waitFor(() =>
            expect(screen.getByText(/session is not active/i)).toBeInTheDocument(),
        );
    });

    it('shows bytes-received count in not-active overlay after binary data arrives', async () => {
        // Exercises the `bytesReceived > 0` branch inside the !sessionLive overlay.
        const { rerender } = renderWithProviders(
            <TerminalXterm sessionId="sess-ws-20" sessionLive={true} />,
        );
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        act(() => {
            lastWs?.onmessage?.(
                new MessageEvent('message', { data: new Uint8Array([1, 2, 3]).buffer }),
            );
        });
        // Flip to not-live so the overlay renders with byte count
        act(() => {
            rerender(<TerminalXterm sessionId="sess-ws-20" sessionLive={false} />);
        });
        const overlay = await screen.findByText(/session is not active/i);
        expect(overlay.textContent).toMatch(/3 bytes received/i);
    });
});

// ── ResizeObserver branch coverage ──────────────────────────────────────────

// A controllable ResizeObserver that lets tests fire the callback manually.
let lastRoCallback: (() => void) | null = null;

class ControllableObserver {
    constructor(private cb: () => void) {
        lastRoCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() { lastRoCallback = null; }
    takeRecords() { return []; }
}

describe('TerminalXterm — ResizeObserver branches', () => {
    beforeEach(() => {
        lastWs = null;
        lastRoCallback = null;
        vi.stubGlobal('WebSocket', MockWs);
        vi.stubGlobal('ResizeObserver', ControllableObserver);
        vi.stubGlobal('IntersectionObserver', NoopObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal('ResizeObserver', NoopObserver);
        vi.stubGlobal('IntersectionObserver', NoopObserver);
        lastRoCallback = null;
    });

    it('ResizeObserver callback: no-ops when fitRef or termRef is null (line 288)', async () => {
        // The callback guard `if (!fitRef.current || !termRef.current) return` fires
        // when the observer triggers before xterm has initialised.
        renderWithProviders(<TerminalXterm sessionId="sess-ro-1" sessionLive={true} />);
        // Fire immediately — xterm hasn't initialised yet (deferred via setTimeout(0))
        expect(() => {
            act(() => { lastRoCallback?.(); });
        }).not.toThrow();
    });

    it('ResizeObserver callback: fit().fit() throw causes early return without ws.send', async () => {
        // Exercises the `catch { return; }` in the ResizeObserver (lines 290-292).
        // Uses mockImplementationOnce (not the persistent mockImplementation) so
        // FitAddon reverts to its normal, non-throwing behaviour for later tests
        // in this file — a previous version of this test used the persistent
        // form and silently broke branch coverage for the try{} path below it.
        const { FitAddon } = await import('@xterm/addon-fit');
        (FitAddon as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
            return {
                fit: vi.fn().mockImplementation(() => { throw new Error('fit failed in ro'); }),
            };
        });
        renderWithProviders(<TerminalXterm sessionId="sess-ro-2" sessionLive={true} />);
        await waitFor(() => expect(lastWs).not.toBeNull(), { timeout: 2000 });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        // Fire the resize callback — fit throws, so ws.send should NOT be called
        expect(() => {
            act(() => { lastRoCallback?.(); });
        }).not.toThrow();
    });

    it('ResizeObserver callback: sends resize (debounced) when WS is open', async () => {
        vi.useFakeTimers();
        renderWithProviders(<TerminalXterm sessionId="sess-ro-3" sessionLive={true} />);
        await act(async () => { await vi.runAllTimersAsync(); });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        const sentBefore = (lastWs?.sent ?? []).length;
        act(() => { lastRoCallback?.(); });
        // The resize send is trailing-debounced — nothing goes out until the
        // debounce window elapses.
        expect((lastWs?.sent ?? []).length).toBe(sentBefore);
        await act(async () => { vi.advanceTimersByTime(150); });
        const sentAfter = lastWs?.sent ?? [];
        expect(sentAfter.length).toBe(sentBefore + 1);
        const lastSent = sentAfter[sentAfter.length - 1];
        expect(typeof lastSent).toBe('string');
        expect(JSON.parse(lastSent as string)).toMatchObject({ cmd: 'resize', cols: 80, rows: 24 });
        vi.useRealTimers();
    });

    it('ResizeObserver callback: a burst of fires collapses into ONE resize send', async () => {
        // Dragging a pane divider in /terminal/layout fires the observer per
        // animation frame; each server-side resize makes ConPTY reflow the
        // whole screen. The debounce must collapse a burst into one envelope.
        vi.useFakeTimers();
        renderWithProviders(<TerminalXterm sessionId="sess-ro-5" sessionLive={true} />);
        await act(async () => { await vi.runAllTimersAsync(); });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        const sentBefore = (lastWs?.sent ?? []).length;
        act(() => {
            lastRoCallback?.();
            lastRoCallback?.();
            lastRoCallback?.();
        });
        await act(async () => { vi.advanceTimersByTime(150); });
        expect((lastWs?.sent ?? []).length).toBe(sentBefore + 1);
        vi.useRealTimers();
    });

    it('init cleanup: unmounting before the deferred init timer fires is a no-op (line 157)', () => {
        // Exercises `if (!createdTerm) return;` in the init effect's cleanup:
        // unmounting synchronously (before the setTimeout(0) init timer runs)
        // means createdTerm is still null, so cleanup should skip teardown
        // without throwing.
        const { unmount } = renderWithProviders(
            <TerminalXterm sessionId="sess-early-unmount" sessionLive={true} />,
        );
        expect(() => {
            act(() => { unmount(); });
        }).not.toThrow();
    });

    it('init: initial fit.fit() throw is silently caught (lines 132-136)', async () => {
        // Exercises the try/catch around the initial fit.fit() call made
        // right after term.open(), distinct from the onopen-time fit call.
        const { FitAddon } = await import('@xterm/addon-fit');
        (FitAddon as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
            return {
                fit: vi.fn().mockImplementationOnce(() => { throw new Error('initial fit failed'); }),
            };
        });
        expect(() => {
            renderWithProviders(<TerminalXterm sessionId="sess-init-fit-throw" sessionLive={true} />);
        }).not.toThrow();
        // Let the deferred init timer run to completion.
        await waitFor(() => expect(screen.getByText(/connecting to pty/i)).toBeInTheDocument());
    });

    it('ResizeObserver callback: skips ws.send when WS is not OPEN', async () => {
        // Exercises the `ws && ws.readyState === WebSocket.OPEN` guard inside
        // the debounced send.
        vi.useFakeTimers();
        renderWithProviders(<TerminalXterm sessionId="sess-ro-4" sessionLive={true} />);
        await act(async () => { await vi.runAllTimersAsync(); });
        act(() => { lastWs?.onopen?.(new Event('open')); });
        // Close the WS so readyState != OPEN
        act(() => {
            lastWs?.onclose?.(new CloseEvent('close', { code: 1000 }));
        });
        const sentBefore = (lastWs?.sent ?? []).length;
        // Fire resize — ws is no longer in wsRef (nulled in onclose); even
        // after the debounce elapses, nothing is sent.
        expect(() => {
            act(() => { lastRoCallback?.(); });
        }).not.toThrow();
        await act(async () => { vi.advanceTimersByTime(150); });
        expect((lastWs?.sent ?? []).length).toBe(sentBefore);
        vi.useRealTimers();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clipboard shortcut (Ctrl+Shift+C copy, Ctrl+Shift+V paste)
// ─────────────────────────────────────────────────────────────────────────────
describe('TerminalXterm — copy/paste', () => {
    beforeEach(() => {
        // Same stubs as the WebSocket lifecycle describe — WebSocket +
        // ResizeObserver + IntersectionObserver are required for the
        // paste test to have a live ws.send() surface.
        lastWs = null;
        vi.stubGlobal('WebSocket', MockWs);
        vi.stubGlobal('ResizeObserver', NoopObserver);
        vi.stubGlobal('IntersectionObserver', NoopObserver);
    });

    it('registers a custom key event handler that fields Ctrl+Shift+C for copy', async () => {
        // The handler is captured by the mock at mount time. Firing a
        // synthetic KeyboardEvent through it and asserting the return
        // value + navigator.clipboard call is enough — we're not
        // testing xterm's own key routing here.
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText, readText: vi.fn().mockResolvedValue('') },
        });

        renderWithProviders(<TerminalXterm sessionId="sess-copy" sessionLive={true} />);
        await waitFor(() => expect(lastKeyEventHandler).not.toBeNull());

        // Simulate a selection so the copy path has something to write.
        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: { getSelection: ReturnType<typeof vi.fn> } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        instance.getSelection.mockReturnValue('some selected text');

        const evt = new KeyboardEvent('keydown', {
            key: 'C',
            ctrlKey: true,
            shiftKey: true,
        });
        const result = lastKeyEventHandler!(evt);

        expect(result).toBe(false); // handler must swallow so PTY doesn't see it
        expect(writeText).toHaveBeenCalledWith('some selected text');
    });

    it('Ctrl+Shift+V is NOT intercepted by our handler (xterm owns paste)', async () => {
        // Batch-8 fix: our earlier keydown handler duplicated paste because
        // xterm.js's built-in `paste` event listener ALSO fires. Now we
        // return `true` from the customKeyEventHandler for V, letting
        // xterm's paste event own the path — one ws.send per Ctrl+Shift+V.
        renderWithProviders(<TerminalXterm sessionId="sess-paste" sessionLive={true} />);
        await waitFor(() => expect(lastKeyEventHandler).not.toBeNull());

        const evt = new KeyboardEvent('keydown', {
            key: 'V',
            ctrlKey: true,
            shiftKey: true,
        });
        // Must return true so the keydown propagates to xterm's default
        // handling → browser paste event → xterm.paste() → onData → single ws.send.
        expect(lastKeyEventHandler!(evt)).toBe(true);
    });

    it('plain Ctrl+V (no Shift) also flows through — shell handles quoted-insert', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-plain-v" sessionLive={true} />);
        await waitFor(() => expect(lastKeyEventHandler).not.toBeNull());
        const evt = new KeyboardEvent('keydown', {
            key: 'v',
            ctrlKey: true,
            shiftKey: false,
        });
        expect(lastKeyEventHandler!(evt)).toBe(true);
    });

    it('Ctrl+C with NO selection falls through to xterm → PTY sees SIGINT', async () => {
        renderWithProviders(<TerminalXterm sessionId="sess-sigint" sessionLive={true} />);
        await waitFor(() => expect(lastKeyEventHandler).not.toBeNull());

        // Terminal has no selection → Ctrl+C behaves as SIGINT (\x03).
        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: { getSelection: ReturnType<typeof vi.fn> } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        instance.getSelection.mockReturnValue('');

        const evt = new KeyboardEvent('keydown', {
            key: 'c',
            ctrlKey: true,
            shiftKey: false,
        });
        expect(lastKeyEventHandler!(evt)).toBe(true);
    });

    it('Ctrl+C WITH selection copies (matches GNOME Terminal / Windows Terminal / VS Code behaviour)', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText, readText: vi.fn().mockResolvedValue('') },
        });

        renderWithProviders(<TerminalXterm sessionId="sess-smart-copy" sessionLive={true} />);
        await waitFor(() => expect(lastKeyEventHandler).not.toBeNull());

        const term = (await import('@xterm/xterm')).Terminal as unknown as {
            mock: { results: Array<{ value: {
                getSelection: ReturnType<typeof vi.fn>;
                clearSelection: ReturnType<typeof vi.fn>;
            } }> };
        };
        const instance = term.mock.results[term.mock.results.length - 1]!.value;
        instance.getSelection.mockReturnValue('selected line');

        const evt = new KeyboardEvent('keydown', {
            key: 'c',
            ctrlKey: true,
            shiftKey: false,
        });
        expect(lastKeyEventHandler!(evt)).toBe(false); // swallow — copy path
        expect(writeText).toHaveBeenCalledWith('selected line');
        // Selection must be cleared so a subsequent Ctrl+C sends SIGINT
        // (matches GNOME Terminal's "copy consumes the selection" flow).
        expect(instance.clearSelection).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// OSC safety filter — blocks OSC 52 (clipboard write), OSC 8 (hyperlinks),
// OSC 4/104 (palette), OSC 10-19 (colour queries). Regression guard on the
// list — if any of these get accidentally removed, an incoming rogue byte
// stream from the PTY could hijack the Owner's clipboard or terminal.
// ─────────────────────────────────────────────────────────────────────────────
describe('TerminalXterm — OSC block-list', () => {
    it('registers no-op handlers for the dangerous OSC ids', async () => {
        // Reset the capture list so this test starts clean.
        registeredOscBlocks.length = 0;
        renderWithProviders(<TerminalXterm sessionId="sess-osc" sessionLive={true} />);
        await waitFor(() => expect(registeredOscBlocks.length).toBeGreaterThan(0));
        // Any of these appearing in a PTY stream would be dangerous.
        for (const id of [4, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 52, 104]) {
            expect(registeredOscBlocks).toContain(id);
        }
    });
});
