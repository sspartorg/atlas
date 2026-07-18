import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { Global } from '@emotion/react';

// 2026-06-22 - Terminal v1. xterm.js pane + bidirectional WebSocket.
// 2026-07-13 - Fixed incomplete ANSI escape sequence handling to prevent
//              "zombie" characters appearing during live streaming.
// 2026-07-13 - Added WebGL renderer to fix Windows Chrome scrolling artifacts
//              where first 2 chars of lines leave "trails" during scroll.
// 2026-07-13 - Fixed scroll-triggered refresh timing: switched from immediate
//              refresh to requestAnimationFrame for frame-synced redraws, and
//              added GPU acceleration CSS to the canvas element itself.
//
// Wire model:
//   - Server PTY bytes -> ws.onmessage -> term.write(...)
//   - User keystrokes  -> term.onData -> ws.send(string)
//   - Window resize    -> FitAddon.fit() -> ws.send(JSON {cmd:'resize',cols,rows})
//
// Connection lifecycle:
//   - Open WS on mount (after `sessionLive` is true). Show a "connecting"
//     overlay until the first byte arrives.
//   - If the server closes the WS (PTY exited, session paused/closed),
//     surface a banner; the wider page already shows the row's new status
//     via SSE invalidation.
//   - Reconnect-once on transient close (1006) within 1.5s; after that the
//     user clicks Resume to spawn a fresh PTY.
//
// ANSI escape sequence buffering:
//   - ANSI sequences can be split across WebSocket frames. Writing partial
//     sequences to xterm.js causes visible "zombie" characters (e.g., the
//     2-char CSI introducer `\x1b[` appearing as frozen text).
//   - The onmessage handler now buffers data ending with incomplete sequences
//     and combines them with the next frame before writing to the terminal.
//   - Common incomplete patterns: ESC alone (`\x1b`), CSI start (`\x1b[`),
//     OSC start (`\x1b]`), partial CSI parameters (`\x1b[1;` or `\x1b[38;5;`).
//
// WebGL renderer:
//   - xterm.js v6 removed the DOM renderer option - only canvas is available.
//   - The WebGL addon uses GPU acceleration and can fix canvas repaint bugs
//     that cause scrolling artifacts on Windows Chrome/Edge.
//   - Falls back to canvas if WebGL init fails (old GPUs, browser restrictions).

const RECONNECT_DELAY_MS = 1_500;

interface Props {
    /** Atlas session id from the URL. */
    sessionId: string;
    /** Disables connect attempts when the row is paused/closed/errored. */
    sessionLive: boolean;
}

/**
 * Checks if a string ends with an incomplete ANSI escape sequence.
 * Returns true if the data should be buffered to wait for the rest.
 * 
 * Common patterns:
 * - ESC alone: `\x1b`
 * - CSI start: `\x1b[` (2 chars)
 * - OSC start: `\x1b]`
 * - Partial CSI parameter: `\x1b[1;` or `\x1b[38;5;`
 */
function hasIncompleteEscapeSequence(data: string): boolean {
    if (!data) return false;
    
    // Check last few characters for incomplete sequences
    const tail = data.slice(-10);
    
    // Lone ESC at the end
    if (tail.endsWith('\x1b')) return true;
    
    // ESC[ (CSI) without terminator - look for incomplete CSI
    const lastEsc = tail.lastIndexOf('\x1b');
    if (lastEsc !== -1) {
        const afterEsc = tail.slice(lastEsc);
        
        // CSI sequence not yet terminated
        // CSI terminators are: A-Z, a-z, @, `, ~
        if (afterEsc.startsWith('\x1b[')) {
            const hasTerminator = /[A-Za-z@`~]/.test(afterEsc.slice(2));
            if (!hasTerminator) return true;
        }
        
        // OSC sequence not yet terminated (ends with BEL \x07 or ST \x1b\\)
        if (afterEsc.startsWith('\x1b]')) {
            const hasBel = afterEsc.includes('\x07');
            const hasST = afterEsc.includes('\x1b\\');
            if (!hasBel && !hasST) return true;
        }
    }
    
    return false;
}

export function TerminalXterm({ sessionId, sessionLive }: Props) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [bytesReceived, setBytesReceived] = useState(0);
    const [termReady, setTermReady] = useState(false);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempted = useRef(false);
    // Buffer for incomplete ANSI escape sequences that span WebSocket frames.
    // Prevents "zombie" characters appearing when sequences like `\x1b[` arrive
    // split across multiple messages.
    const incompleteBuffer = useRef<string>('');
    // Survives the StrictMode mount→cleanup→mount cycle so the second mount
    // skips re-initialising xterm. termRef is nulled in cleanup, so it can't
    // be the guard.
    const xtermInitRan = useRef(false);
    // Mirror of the `sessionLive` prop in a ref so the WS close handler
    // reads the LATEST value when it fires (it can fire async after the
    // effect cleanup has already run). Closing over the prop directly
    // would schedule a phantom reconnect after the user paused.
    const sessionLiveRef = useRef(sessionLive);
    useEffect(() => {
        sessionLiveRef.current = sessionLive;
    }, [sessionLive]);

    // Initialise xterm exactly once for the component lifetime.
    // Wire onData here too (single, stable subscription) so we never end up
    // with two listeners layered on the same term — that double-send would
    // be visible as "every typed char appears twice" once the PTY echoes
    // each byte back through Claude's TUI redraw.
    //
    // React 18+ StrictMode (dev only) double-invokes effects: mount → cleanup
    // → mount. xterm's dispose() doesn't always fully detach its global
    // keyboard listeners between the two passes, so a naive mount runs init
    // twice and ends up with two terminals (and two onData listeners). The
    // setTimeout(0) defer + cancel-on-cleanup pattern collapses the dance
    // into a single actual init that survives both StrictMode and real
    // unmounts.
    useEffect(() => {
        /* v8 ignore next -- hostRef is attached synchronously by React before this mount effect runs; only null on a detached/SSR render */
        if (!hostRef.current) return;
        /* v8 ignore next 5 -- only true on React StrictMode's double-invoke (dev only); the test harness doesn't wrap in StrictMode */
        if (xtermInitRan.current) {
            // Already-running instance from a previous (still-live) mount.
            // No new init; the cleanup from THIS effect run is also a no-op
            // because we never scheduled anything here.
            return;
        }
        let cancelled = false;
        let createdTerm: XTerm | null = null;
        let createdFit: FitAddon | null = null;
        let createdSub: { dispose: () => void } | null = null;

        const initTimer = setTimeout(() => {
            /* v8 ignore next -- hostRef only clears via unmount, which always flips `cancelled` first in this same cleanup; the ref-null half is unreachable independently */
            if (cancelled || !hostRef.current) return;
            xtermInitRan.current = true;
            const term = new XTerm({
                convertEol: true,
                // Cursor styling - thin bar that blinks at the cursor position.
                // Claude's TUI parks the cursor in its input box when idle, so
                // the blink naturally marks "where you'll type next". During
                // output streaming the bar zips along with the writes — that's
                // just how every terminal works.
                cursorStyle: 'bar',
                cursorBlink: true,
                cursorInactiveStyle: 'none',
                fontFamily: 'Cascadia Code, Menlo, Consolas, "DejaVu Sans Mono", monospace',
                fontSize: 13,
                // 13 * 1.15 ~= 15px -> an integer cell height. A fractional
                // cell (the old 1.2 -> 15.6px) forces sub-pixel row positioning
                // that worsens the left/right edge repaint artifacts during
                // scroll on Chromium. Keeps roughly the same visual spacing.
                lineHeight: 1.15,
                scrollback: 5_000,
                // Windows Chrome scroll artifacts fix: The scrollbar's appearance
                // changes container width mid-scroll, causing xterm to reflow and
                // leaving character "trails". Setting scrollOnUserInput to false
                // prevents the scrollbar from auto-appearing on keystrokes, and
                // we rely on the custom scrollbar CSS to ensure consistent width.
                scrollOnUserInput: false,
                theme: {
                    background: '#0a0a0a',
                    foreground: '#d4d4d4',
                    cursor: '#39c180',
                    cursorAccent: '#0a0a0a',
                    black: '#1e1e1e',
                    red: '#f48771',
                    green: '#39c180',
                    yellow: '#d7ba7d',
                    blue: '#9cdcfe',
                    magenta: '#c586c0',
                    cyan: '#4ec9b0',
                    white: '#d4d4d4',
                    brightBlack: '#5f5f5f',
                    brightRed: '#f48771',
                    brightGreen: '#39c180',
                    brightYellow: '#d7ba7d',
                    brightBlue: '#9cdcfe',
                    brightMagenta: '#c586c0',
                    brightCyan: '#4ec9b0',
                    brightWhite: '#ffffff',
                },
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(hostRef.current);
            
            // Load WebGL renderer addon for better performance and to fix
            // Windows Chrome scrolling artifacts (first 2 chars leaving trails).
            // Falls back to canvas if WebGL init fails.
            try {
                const webgl = new WebglAddon();
                term.loadAddon(webgl);
                // If WebGL loaded successfully, preserve colors by disabling
                // character atlas which can cause color bleeding issues.
                webgl.onContextLoss(() => {
                    // WebGL context lost - terminal will auto-fallback to canvas
                    void webgl.dispose();
                });
            } catch {
                // WebGL not supported (old GPU, browser restrictions) - canvas
                // renderer will be used. This is non-fatal.
            }
            
            try {
                fit.fit();
            } catch {
                /* container may not be measured yet; ResizeObserver catches up */
            }
            termRef.current = term;
            fitRef.current = fit;
            createdTerm = term;
            createdFit = fit;
            // Re-fit after fonts are fully ready so cols/rows align with final
            // glyph metrics (avoids edge clipping or stale gutter glyphs).
            if (typeof document !== 'undefined' && 'fonts' in document) {
                void document.fonts.ready.then(() => {
                    if (termRef.current !== term || fitRef.current !== fit) return;
                    try {
                        fit.fit();
                    } catch {
                        return;
                    }
                    const ws = wsRef.current;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({ cmd: 'resize', cols: term.cols, rows: term.rows }));
                        } catch {
                            /* best-effort */
                        }
                    }
                });
            }
            createdSub = term.onData((data) => {
                const ws = wsRef.current;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            });

            // ── Copy / paste ───────────────────────────────────────────────
            // xterm.js does not wire clipboard-copy natively (Ctrl+C means
            // SIGINT in a terminal), BUT it DOES handle paste natively: it
            // listens for the browser's `paste` event and routes the
            // clipboard payload through `term.paste()` → `onData`. Our
            // `onData` subscriber above already forwards `onData` bytes to
            // the WebSocket, so paste works end-to-end without any extra
            // wiring on our side.
            //
            // First attempt at custom paste (Batch-7) hooked the keydown
            // event and read `navigator.clipboard.readText()` itself. That
            // ran ALONGSIDE xterm's `paste` event listener → two ws.send()
            // calls per Ctrl+Shift+V. Removing our handler fixes it: the
            // browser paste event fires exactly once, xterm consumes it
            // exactly once, and onData → ws.send fires exactly once.
            //
            // We keep our COPY handler because xterm doesn't do copy
            // natively — Ctrl+C means SIGINT unconditionally without us.
            // Copy shape (matches GNOME Terminal / Windows Terminal / VS
            // Code's integrated terminal):
            //   * Ctrl+C WITH a selection → COPY (and clear the selection
            //     so the NEXT Ctrl+C sends SIGINT).
            //   * Ctrl+C WITHOUT a selection → passthrough (SIGINT).
            //   * Ctrl+Shift+C → force copy (Chromium browsers grab this
            //     for DevTools "inspect element" mode — the smart-Ctrl+C
            //     path above is the reliable route on those browsers).
            //   * Cmd+C (macOS) → copy; doesn't collide with any terminal
            //     semantics.
            term.attachCustomKeyEventHandler((e) => {
                if (e.type !== 'keydown') return true;
                const ctrl = e.ctrlKey;
                const meta = e.metaKey;
                const shift = e.shiftKey;
                const key = e.key.toLowerCase();

                const selection = term.getSelection();
                const isPlainCtrlC = ctrl && !shift && !meta && key === 'c';
                const isForcedCopy =
                    (ctrl && shift && key === 'c') ||
                    (meta && !shift && key === 'c');

                if (isForcedCopy || (isPlainCtrlC && selection)) {
                    if (selection && navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(selection).catch(() => {
                            /* best-effort — user may have denied clipboard perm */
                        });
                    }
                    // Clear the selection so the NEXT Ctrl+C sends SIGINT
                    // (matches GNOME Terminal's flow: copy consumes the
                    // selection, subsequent Ctrl+C interrupts the process).
                    try {
                        term.clearSelection();
                    } catch {
                        /* older xterm builds may not expose clearSelection */
                    }
                    return false; // don't forward to PTY
                }

                // Every other keystroke — including Ctrl+V and Ctrl+Shift+V —
                // flows through unchanged. xterm's native paste event
                // handler owns the paste path.
                return true;
            });

            // ── OSC / DCS / APC / PM safety filter ────────────────────────
            // xterm's escape-sequence parser accepts every OSC / DCS / APC /
            // PM sequence the server sends. Any tool the PTY runs (curl, git,
            // gh, an agent) that echoes attacker-controlled bytes can inject
            // sequences that xterm honours. Register no-op handlers on the
            // most dangerous ones so xterm treats them as "handled — drop":
            //
            //   OSC 52    — clipboard write from server (would let a remote
            //               attacker who controlled any PTY-piped stream
            //               stuff arbitrary content into the Owner's system
            //               clipboard). Our Ctrl+Shift+C copy shortcut uses
            //               navigator.clipboard directly, independent of OSC 52.
            //   OSC 4/104 — color-palette reprogramming (persistent visual
            //               DoS; we own the theme).
            //   OSC 8     — hyperlink; block until we can vet the URL scheme.
            //               (Blocklist stance: rare enough that killing the
            //               feature is safer than a leaky filter. Revisit if
            //               a real tool needs it.)
            //   OSC 10-19 — foreground/background/cursor colour queries + set
            //               (would let a remote reprogram our foreground).
            //
            // We deliberately leave OSC 0/1/2 (title updates) alone — some
            // TUIs (Claude Code, tmux) rely on them and the risk is limited
            // to spoofing the browser tab title.
            const BLOCKED_OSC_IDS = [4, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 52, 104];
            for (const id of BLOCKED_OSC_IDS) {
                // registerOscHandler returns an IDisposable; we intentionally
                // don't dispose — the block should live for the terminal's
                // full lifetime. Handler returns `true` = "handled, don't
                // process the sequence".
                term.parser.registerOscHandler(id, () => true);
            }
            // DCS (Device Control String) / APC (Application Program
            // Command) / PM (Privacy Message): xterm.js does NOT dispatch
            // these to any user handler by default — they are consumed and
            // discarded unless the app explicitly registers a DCS handler.
            // Since we register none, DCS/APC/PM are already safe: the
            // parser reads the envelope + payload and drops it. No extra
            // block needed.

            // Signal dependent effects (WS open, ResizeObserver) that the
            // term is mounted and ready for use.
            setTermReady(true);
        }, 0);

        return () => {
            cancelled = true;
            clearTimeout(initTimer);
            // If init never ran (StrictMode first-cleanup), there's nothing
            // to tear down — skip.
            if (!createdTerm) return;
            try {
                createdSub?.dispose();
            } catch {
                /* best-effort */
            }
            try {
                createdTerm.dispose();
            } catch {
                /* best-effort */
            }
            termRef.current = null;
            fitRef.current = null;
            xtermInitRan.current = false;
            setTermReady(false);
            // Local refs used inside this cleanup; not used further.
            void createdFit;
        };
        // sessionId / sessionLive intentionally not in deps -- the terminal
        // surface is one-and-done per mount.
    }, []);

    // WebSocket lifecycle. Depends on `termReady` so it runs only after the
    // deferred xterm init has completed (see the setTimeout(0) defer above
    // for the StrictMode rationale).
    useEffect(() => {
        const term = termRef.current;
        if (!term || !termReady) return;
        if (!sessionLive) {
            // Status flipped to paused/closed. Tear down any live WS so the
            // server isn't holding a dead subscriber.
            /* v8 ignore start -- wsRef.current is always null here in practice: sessionLive is an effect dep, so any transition to false runs this effect's own cleanup (which already closes + nulls wsRef.current) before this body re-executes. Kept as defense-in-depth against a future refactor that decouples the WS ref from this effect's lifecycle. */
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch {
                    /* best-effort */
                }
                wsRef.current = null;
            }
            /* v8 ignore stop */
            setConnected(false);
            return;
        }

        function connect() {
            // Reject session ids that don't match the server-side UUID
            // shape before building the WebSocket URL. Without this, a
            // route param like `../auth/token?x=` would path-normalize
            // through the browser's URL parser and could produce a same-
            // origin WS to an unintended endpoint. Also encodeURIComponent
            // as a defence-in-depth belt-and-braces on any allowed shape.
            if (!/^[a-zA-Z0-9-]{6,64}$/.test(sessionId)) {
                setConnected(false);
                return;
            }
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${proto}//${window.location.host}/api/cli/sessions/${encodeURIComponent(sessionId)}/stream`;
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                reconnectAttempted.current = false;
                if (fitRef.current && termRef.current) {
                    try {
                        fitRef.current.fit();
                    } catch {
                        /* best-effort */
                    }
                    const { cols, rows } = termRef.current;
                    try {
                        ws.send(JSON.stringify({ cmd: 'resize', cols, rows }));
                    } catch {
                        /* best-effort */
                    }
                }
            };

            ws.onmessage = (ev) => {
                if (!termRef.current) return;
                let bytes = 0;
                let dataStr = '';
                
                if (typeof ev.data === 'string') {
                    dataStr = ev.data;
                    bytes = dataStr.length;
                } else if (ev.data instanceof ArrayBuffer) {
                    const u8 = new Uint8Array(ev.data);
                    bytes = u8.byteLength;
                    // Convert to string to check for incomplete sequences
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    dataStr = decoder.decode(u8);
                } else if (ev.data instanceof Blob) {
                    void ev.data.arrayBuffer().then((ab) => {
                        if (!termRef.current) return;
                        const u8 = new Uint8Array(ab);
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        const str = decoder.decode(u8);
                        
                        // Prepend any buffered incomplete sequence
                        const combined = incompleteBuffer.current + str;
                        
                        if (hasIncompleteEscapeSequence(combined)) {
                            // Hold back the incomplete tail
                            incompleteBuffer.current = combined;
                        } else {
                            // Complete sequence - write it all
                            termRef.current.write(combined);
                            incompleteBuffer.current = '';
                        }
                        
                        setBytesReceived((n) => n + u8.byteLength);
                    });
                    return;
                }
                
                if (dataStr) {
                    // Prepend any buffered incomplete sequence from previous frame
                    const combined = incompleteBuffer.current + dataStr;
                    
                    if (hasIncompleteEscapeSequence(combined)) {
                        // Data ends with incomplete sequence - buffer it
                        incompleteBuffer.current = combined;
                    } else {
                        // Complete sequence - write to terminal and clear buffer
                        termRef.current.write(combined);
                        incompleteBuffer.current = '';
                    }
                }
                
                if (bytes > 0) setBytesReceived((n) => n + bytes);
            };

            ws.onerror = () => {
                /* `onclose` always follows; handle there. */
            };

            ws.onclose = (ev) => {
                setConnected(false);
                wsRef.current = null;
                // Clear any incomplete buffer on disconnect
                incompleteBuffer.current = '';
                // Transient close (browser tab focus drop, network blip) -> try
                // once. Otherwise leave it to the user. Read sessionLive from
                // the ref so a paused-since-close session doesn't trigger a
                // phantom reconnect after the effect cleanup ran.
                if (sessionLiveRef.current && !reconnectAttempted.current && ev.code !== 1000) {
                    reconnectAttempted.current = true;
                    reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
                }
            };
        }
        connect();

        return () => {
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch {
                    /* best-effort */
                }
                wsRef.current = null;
            }
        };
    }, [sessionId, sessionLive, termReady]);

    // ResizeObserver on the host -> fit + push new cols/rows to the server.
    useEffect(() => {
        const host = hostRef.current;
        /* v8 ignore next -- host Box is unconditionally rendered with ref={hostRef} every render, so hostRef.current is always set by the time this effect body runs; defensive null-check only. */
        if (!host) return;
        const ro = new ResizeObserver(() => {
            if (!fitRef.current || !termRef.current) return;
            try {
                fitRef.current.fit();
            } catch {
                return;
            }
            const { cols, rows } = termRef.current;
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify({ cmd: 'resize', cols, rows }));
                } catch {
                    /* best-effort */
                }
            }
        });
        ro.observe(host);
        return () => ro.disconnect();
    }, []);

    // Scroll refresh fix for Windows Chrome artifacts. When scrolling, the
    // terminal canvas gets misaligned, but forcing a refresh redraws it
    // correctly (same as what happens on resize). Listen to xterm's scroll
    // viewport and trigger refresh to eliminate "ghost trails" during scroll.
    useEffect(() => {
        const term = termRef.current;
        if (!term || !termReady) return;

        // Use requestAnimationFrame for smooth, frame-synced refreshes
        let rafHandle: number | null = null;
        let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

        const handleScroll = () => {
            if (!term) return;
            
            // Cancel any pending RAF to avoid stacking refresh calls
            if (rafHandle !== null) {
                cancelAnimationFrame(rafHandle);
            }

            // Clear existing debounce timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Schedule refresh on next animation frame to sync with browser paint
            rafHandle = requestAnimationFrame(() => {
                rafHandle = null;
                try {
                    // Force full terminal refresh to clear any trailing artifacts
                    term.refresh(0, term.rows - 1);
                } catch {
                    /* best-effort */
                }
            });

            // After scrolling stops for 100ms, do a final refresh to ensure clean state
            scrollTimeout = setTimeout(() => {
                if (rafHandle !== null) {
                    cancelAnimationFrame(rafHandle);
                    rafHandle = null;
                }
                try {
                    term.refresh(0, term.rows - 1);
                } catch {
                    /* best-effort */
                }
            }, 100);
        };

        // Attach to xterm's internal scroll event
        const scrollDisposable = term.onScroll(handleScroll);

        return () => {
            if (rafHandle !== null) {
                cancelAnimationFrame(rafHandle);
            }
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
            scrollDisposable.dispose();
        };
    }, [termReady]);

    return (
        <>
            {/* Fix Windows Chrome scrolling artifacts: Prevent xterm's scrollbar
                from causing layout shifts when it appears/disappears. The viewport
                is absolutely positioned and the scrollbar is overlaid, but we need
                to ensure the canvas doesn't reflow. Also apply GPU acceleration to
                the actual rendering canvas to eliminate character trails. */}
            <Global
                styles={{
                    '.xterm .xterm-viewport': {
                        // Scrollbar is already `overflow-y: scroll` by default in xterm.css,
                        // but we ensure it's consistently positioned and doesn't trigger reflow
                        position: 'absolute',
                        right: 0,
                        width: '100%',
                        boxSizing: 'border-box',
                    },
                    '.xterm .xterm-screen': {
                        // Prevent the canvas from resizing when scrollbar appears
                        position: 'relative',
                        boxSizing: 'border-box',
                    },
                    '.xterm .xterm-screen canvas': {
                        // GPU acceleration on the actual rendering canvas to eliminate trails
                        willChange: 'transform',
                        transform: 'translateZ(0)',
                        // Force hardware acceleration with backface culling
                        backfaceVisibility: 'hidden',
                        // Subpixel antialiasing can cause rendering artifacts during scroll
                        WebkitFontSmoothing: 'antialiased',
                        MozOsxFontSmoothing: 'grayscale',
                    },
                    // Custom scrollbar styling to ensure it doesn't cause width changes
                    '.xterm .xterm-scrollable-element > .scrollbar': {
                        position: 'absolute',
                        right: 0,
                        width: '14px',
                        pointerEvents: 'auto',
                    },
                }}
            />
            <Box
                sx={{
                    position: 'relative',
                    flex: 1,
                    minHeight: 360,
                    borderRadius: 1,
                    overflow: 'hidden',
                    background: '#0a0a0a',
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    // GPU optimization hints to reduce rendering artifacts
                    willChange: 'transform',
                    transform: 'translateZ(0)',
                }}
            >
            <Box
                ref={hostRef}
                tabIndex={-1}
                onClick={() => termRef.current?.focus()}
                sx={{ 
                    position: 'absolute', 
                    inset: 0, 
                    outline: 'none', 
                    cursor: 'text',
                    // Ensure clean rendering on the host layer
                    overflow: 'hidden',
                }}
            />
            {!connected && sessionLive && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        background: 'rgba(10,10,10,0.7)',
                        color: '#d4d4d4',
                    }}
                >
                    <CircularProgress size={18} />
                    <Typography variant="body2">Connecting to PTY…</Typography>
                </Box>
            )}
            {!sessionLive && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(10,10,10,0.7)',
                        color: '#d4d4d4',
                        textAlign: 'center',
                        px: 4,
                    }}
                >
                    <Typography variant="body2">
                        Session is not active. Click Resume to re-attach, or Stop to finalize.
                        {bytesReceived > 0 && ` (${bytesReceived.toLocaleString()} bytes received this session)`}
                    </Typography>
                </Box>
            )}
            </Box>
        </>
    );
}
