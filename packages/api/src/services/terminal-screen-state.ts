/**
 * terminal-screen-state.ts
 *
 * Per-session headless xterm mirror. Every PTY byte is parsed into this
 * terminal, and WebSocket attach replays `snapshot()` — a freshly
 * serialized, well-formed VT stream — instead of a raw byte-window of
 * history. A byte-window replay can begin mid-escape-sequence or
 * mid-codepoint (rendering "zombie" characters), contains live DSR
 * queries the browser auto-answers into the PTY, and reflects stale
 * geometry; a serialized snapshot has none of those failure modes.
 *
 * Ordering contract: `feed` callbacks and `whenFlushed` callbacks fire
 * FIFO through xterm's write queue. Broadcasting live bytes from the
 * `feed` callback and sending the snapshot from `whenFlushed` therefore
 * guarantees an attaching subscriber sees exactly the bytes up to its
 * flush point in the snapshot, and every later byte live — no gap, no
 * duplicate.
 */

import { createRequire } from 'node:module';
import type { ITerminalAddon, Terminal as TerminalClass } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

// `@xterm/headless` ships a CommonJS bundle and its `module` field points
// at a path that doesn't exist in the package, so Node's ESM loader falls
// back to the CJS entry — where cjs-module-lexer cannot see `Terminal` and
// a named import throws at load time, crashing the API at boot. Bundlers
// and Vitest paper over this; plain `node`/`tsx` does not. Requiring the
// module explicitly is the interop-safe form and keeps full typings.
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless') as {
    Terminal: new (options?: ConstructorParameters<typeof TerminalClass>[0]) => TerminalClass;
};

// Matches the browser pane's scrollback (TerminalXterm.tsx) so a replayed
// snapshot never contains more history than the client can retain.
const MIRROR_SCROLLBACK_ROWS = 5_000;

/** Passed through to xterm's `windowsPty` option when the PTY host is
 *  Windows. ConPTY answers resizes by repainting the screen from its own
 *  buffer, assuming the receiving terminal did NOT reflow or pull rows
 *  back out of scrollback — windowsPty makes xterm honor that contract.
 *  Without it the mirror's rows drift out of alignment with ConPTY's
 *  model and every subsequent diff repaint lands offset, stranding stale
 *  cells (the Windows "zombie characters"). */
export interface WindowsPtyHostInfo {
    backend: 'conpty' | 'winpty';
    buildNumber?: number;
}

export interface TerminalScreenState {
    /** Parse PTY output; `onParsed` fires after xterm consumed the chunk. */
    feed(data: string, onParsed: () => void): void;
    /** Fires after everything fed before this call has been parsed. */
    whenFlushed(cb: () => void): void;
    /** Serialized VT stream reconstructing screen + scrollback + colors. */
    snapshot(): string;
    /** After dispose every method is a silent no-op — attach flushes can
     *  race pause/exit teardown and must not crash or fire late. */
    dispose(): void;
}

export function createScreenState(
    cols: number,
    rows: number,
    windowsPty?: WindowsPtyHostInfo,
): TerminalScreenState {
    const term = new Terminal({
        cols,
        rows,
        scrollback: MIRROR_SCROLLBACK_ROWS,
        // Must match the browser pane's convertEol so mirror and client
        // interpret a bare LF identically.
        convertEol: true,
        // SerializeAddon registers proposed-API consumers on activate.
        allowProposedApi: true,
        // Spread-conditional so the key is absent (not undefined) off-Windows.
        ...(windowsPty ? { windowsPty } : {}),
    });
    const serialize = new SerializeAddon();
    // SerializeAddon's typings target the browser build's Terminal, but
    // headless is an officially supported host and the addon surface is
    // identical — the cast bridges the nominal type gap only.
    term.loadAddon(serialize as unknown as ITerminalAddon);

    let disposed = false;

    return {
        feed(data: string, onParsed: () => void): void {
            if (disposed) return;
            term.write(data, () => {
                if (!disposed) onParsed();
            });
        },
        whenFlushed(cb: () => void): void {
            if (disposed) return;
            // An empty write rides the same FIFO queue as prior feeds, so
            // its callback is the "everything before me is parsed" marker.
            term.write('', () => {
                if (!disposed) cb();
            });
        },
        snapshot(): string {
            if (disposed) return '';
            return serialize.serialize({ scrollback: MIRROR_SCROLLBACK_ROWS });
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            term.dispose();
        },
    };
}
