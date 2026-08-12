import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_COLS, TERMINAL_ROWS } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

// 2026-06-22 - Terminal v1. xterm.js pane + bidirectional WebSocket.
// 2026-07-31 - Rebuilt the receive path as a raw byte pipe (writeWsFrame).
//              xterm's write() is a stateful streaming parser: it resumes
//              split escape sequences AND split UTF-8 codepoints across
//              calls, so the client must do NO decoding or buffering of its
//              own. The previous hand-rolled escape-sequence buffer and
//              per-frame TextDecoder were themselves producing the "zombie"
//              characters they tried to prevent. Server-side, attach now
//              replays a serialized screen snapshot instead of a raw byte
//              backlog, so a replay can never begin mid-sequence either.
//
// Wire model:
//   - Server PTY bytes -> ws.onmessage -> term.write(raw bytes). Terminal
//     data is ALWAYS binary; text frames are control envelopes. The first
//     frame of every attach is the `ptyInfo` envelope, which flips xterm's
//     ConPTY compatibility mode (`windowsPty`) on when the PTY host is
//     Windows — see writeWsFrame for why that mode is load-bearing.
//   - Next frame is a serialized screen snapshot from the server's
//     headless mirror — already well-formed VT, no special-casing.
//   - User keystrokes  -> term.onData -> ws.send(string)
//   - Container resize -> the GRID never changes. The terminal is pinned
//     to TERMINAL_COLS x TERMINAL_ROWS (shared constant, matching the PTY
//     and the server mirror); a pane resize rescales the FONT to fit the
//     width (fitFontToWidth below). No {cmd:'resize'} is ever sent.
//     History: the grid used to follow the pane via FitAddon + resize
//     envelopes + a drift watchdog. Every variant of that left windows
//     where the PTY's believed width and this terminal's width differed,
//     and any such window strands unerased cells from Ink-style TUI
//     repaints (ConPTY makes it acute by repainting its whole buffer on
//     every resize). With one PTY and N viewers dynamic geometry can never
//     be mismatch-free, so it is pinned. Do not reintroduce a resize path.
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
// Renderer:
//   - xterm v6 core, no addon. `@xterm/addon-webgl` was dropped 2026-08-04
//     for bundle budget, briefly restored on 2026-08-11 on the theory that it
//     was masking the reported glyph "trails" on Windows, and removed again
//     when it demonstrably did not fix them. Same for the compositor hints
//     (willChange/translateZ), scrollOnUserInput:false, and a scroll-triggered
//     refresh(): all restored on that theory, none of them changed the
//     symptom.
//   - The trails are not a rendering defect. A reproduction harness showed
//     the corruption depends only on the terminal's width differing from
//     the width the PTY was told, and reproduces on macOS at that geometry
//     with any renderer. The fix is the pinned grid described above.
//   - So: do not reach for a renderer change if trails resurface. Check
//     that term.cols is still TERMINAL_COLS and that nothing resizes the
//     PTY server-side.

const RECONNECT_DELAY_MS = 1_500;
// Trailing debounce for the font refit on pane resize. Purely cosmetic —
// the grid never changes — so tracking a divider drag frame-by-frame buys
// nothing and re-measuring glyph metrics per animation frame is wasted work.
const FONT_FIT_DEBOUNCE_MS = 100;
// fitFontToWidth bounds. Below 8px a 120-col grid is unreadable anyway and
// the loop needs a floor; above 24px a huge pane just gets whitespace.
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 24;
const FONT_SIZE_DEFAULT = 13;

interface Props {
    /** Atlas session id from the URL. */
    sessionId: string;
    /** Disables connect attempts when the row is paused/closed/errored. */
    sessionLive: boolean;
}

/**
 * The entire client receive path. Binary frames are PTY bytes handed to
 * xterm untouched — its own stateful UTF-8 decoder reassembles codepoints
 * split across frames, and its parser resumes escape sequences split
 * across writes. Text frames are control envelopes from the server, never
 * terminal data; the only one today is `ptyInfo`, which carries the PTY
 * host's Windows backend so xterm's ConPTY compatibility mode
 * (`windowsPty`) can be switched on. With the grid pinned (no resizes,
 * ever) the mode's resize semantics should never trigger, but it also
 * covers ConPTY's other repaint assumptions (e.g. wrapped-line marking),
 * so it stays applied whenever the host is Windows. Returns the PTY byte
 * count for the bytes-received counter (0 for control frames).
 */
export function writeWsFrame(term: Pick<XTerm, 'write' | 'options'>, data: unknown): number {
    if (typeof data === 'string') {
        try {
            const ctrl = JSON.parse(data) as {
                cmd?: string;
                windowsPty?: { backend?: 'conpty' | 'winpty'; buildNumber?: number };
            };
            if (ctrl.cmd === 'ptyInfo' && ctrl.windowsPty?.backend) {
                term.options.windowsPty = ctrl.windowsPty;
            }
        } catch {
            // Unrecognised text frame — drop. PTY data is always binary.
        }
        return 0;
    }
    if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        term.write(bytes);
        return bytes.byteLength;
    }
    return 0;
}

/**
 * Scale the terminal's FONT so the fixed TERMINAL_COLS-wide grid fits the
 * host's width. This replaces FitAddon: the grid is pinned to match the
 * PTY, so panes adapt by font size (the tmux/asciinema model), never by
 * cols/rows. Strategy: proportional guess from the currently rendered
 * width (integer font sizes only, clamped to [FONT_SIZE_MIN,
 * FONT_SIZE_MAX]), then a rAF-deferred check that steps down 1px at a
 * time if integer cell rounding still overflows — deferred because xterm
 * re-measures glyph metrics asynchronously after an options change.
 * No-ops when either measurement is 0 (detached host, jsdom).
 */
export function fitFontToWidth(
    term: Pick<XTerm, 'options' | 'element'>,
    host: HTMLElement,
): void {
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return;
    const avail = host.clientWidth;
    const rendered = screen.clientWidth;
    if (avail <= 0 || rendered <= 0) return;
    const current = term.options.fontSize ?? FONT_SIZE_DEFAULT;
    const next = Math.max(
        FONT_SIZE_MIN,
        Math.min(FONT_SIZE_MAX, Math.floor((current * avail) / rendered)),
    );
    if (next !== current) term.options.fontSize = next;
    const settle = () => {
        // The deferred pass can land after unmount; a detached screen means
        // the terminal was disposed and its options must not be touched.
        if (!screen.isConnected) return;
        const size = term.options.fontSize ?? next;
        if (size > FONT_SIZE_MIN && screen.clientWidth > host.clientWidth) {
            term.options.fontSize = size - 1;
            requestAnimationFrame(settle);
        }
    };
    requestAnimationFrame(settle);
}

export function TerminalXterm({ sessionId, sessionLive }: Props) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [bytesReceived, setBytesReceived] = useState(0);
    const [termReady, setTermReady] = useState(false);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempted = useRef(false);
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
        let createdSub: { dispose: () => void } | null = null;

        const initTimer = setTimeout(() => {
            /* v8 ignore next -- hostRef only clears via unmount, which always flips `cancelled` first in this same cleanup; the ref-null half is unreachable independently */
            if (cancelled || !hostRef.current) return;
            xtermInitRan.current = true;
            const term = new XTerm({
                // The pinned grid — matches the PTY spawn size and the
                // server mirror exactly, for the whole session lifetime.
                cols: TERMINAL_COLS,
                rows: TERMINAL_ROWS,
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
                fontSize: FONT_SIZE_DEFAULT,
                // Visual choice only: slightly tighter than xterm's default
                // spacing to fit more TUI rows in the pane.
                lineHeight: 1.15,
                scrollback: 5_000,
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
            term.open(hostRef.current);

            fitFontToWidth(term, hostRef.current);
            termRef.current = term;
            createdTerm = term;
            // Re-fit the font after webfonts land — glyph metrics change
            // when Cascadia Code swaps in for the fallback monospace, which
            // changes the rendered grid width the fit is computed from.
            if (typeof document !== 'undefined' && 'fonts' in document) {
                void document.fonts.ready.then(() => {
                    if (termRef.current !== term || !hostRef.current) return;
                    fitFontToWidth(term, hostRef.current);
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
            xtermInitRan.current = false;
            setTermReady(false);
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
            // No geometry in the attach URL: client, PTY, and server mirror
            // are all pinned to TERMINAL_COLS x TERMINAL_ROWS, so the
            // snapshot is always laid out exactly as this terminal renders it.
            const url = `${proto}//${window.location.host}/api/cli/sessions/${encodeURIComponent(sessionId)}/stream`;
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                reconnectAttempted.current = false;
            };

            ws.onmessage = (ev) => {
                const term = termRef.current;
                if (!term) return;
                const bytes = writeWsFrame(term, ev.data);
                if (bytes > 0) setBytesReceived((n) => n + bytes);
            };

            ws.onerror = () => {
                /* `onclose` always follows; handle there. */
            };

            ws.onclose = (ev) => {
                setConnected(false);
                wsRef.current = null;
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

    // ResizeObserver on the host -> refit the FONT (trailing-debounced).
    // The grid never changes, so this is purely local and cosmetic; nothing
    // is sent to the server. Zoom changes and webfont swaps that alter cell
    // metrics without resizing the host are caught by the fonts.ready refit
    // above and by the observer firing on the next real layout change —
    // and even a missed refit is only a too-small/clipped FONT, never
    // corrupted terminal content.
    useEffect(() => {
        if (!termReady) return;
        const host = hostRef.current;
        /* v8 ignore next -- host Box is unconditionally rendered with ref={hostRef} every render, so hostRef.current is always set by the time this effect body runs; defensive null-check only. */
        if (!host) return;
        let fontFitTimer: ReturnType<typeof setTimeout> | null = null;
        const ro = new ResizeObserver(() => {
            if (fontFitTimer) clearTimeout(fontFitTimer);
            fontFitTimer = setTimeout(() => {
                fontFitTimer = null;
                if (termRef.current) fitFontToWidth(termRef.current, host);
            }, FONT_FIT_DEBOUNCE_MS);
        });
        ro.observe(host);
        return () => {
            if (fontFitTimer) clearTimeout(fontFitTimer);
            ro.disconnect();
        };
    }, [termReady]);

    return (
        <>
            <Box
                sx={{
                    position: 'relative',
                    flex: 1,
                    minHeight: 360,
                    borderRadius: 1,
                    overflow: 'hidden',
                    background: '#0a0a0a',
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
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
