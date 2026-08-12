/**
 * terminal-screen-state.test.ts
 *
 * Behavioral tests for the per-session headless terminal mirror that
 * replaces the raw byte-ring backlog replay. Uses REAL @xterm/headless —
 * no mocks — because the whole point of the module is that xterm's
 * stateful parser produces a well-formed serialized snapshot where the
 * old byte-slicing produced zombie characters.
 *
 * Verification technique: snapshots are round-tripped into a second
 * headless terminal and asserted on rendered buffer lines, exactly the
 * way the browser xterm will consume the attach frame.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Terminal } from '@xterm/headless';

import { createScreenState } from './terminal-screen-state.js';
import type { TerminalScreenState } from './terminal-screen-state.js';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function feedAsync(state: TerminalScreenState, data: string): Promise<void> {
    return new Promise((resolve) => state.feed(data, resolve));
}

function flushAsync(state: TerminalScreenState): Promise<void> {
    return new Promise((resolve) => state.whenFlushed(resolve));
}

/** Renders a snapshot the way the browser will: write into a fresh terminal. */
async function renderSnapshot(
    snapshot: string,
    cols: number,
    rows: number,
): Promise<string[]> {
    const term = new Terminal({ cols, rows, scrollback: 5_000, allowProposedApi: true });
    await new Promise<void>((resolve) => term.write(snapshot, resolve));
    const lines: string[] = [];
    const buf = term.buffer.active;
    for (let y = 0; y < buf.length; y++) {
        lines.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    term.dispose();
    return lines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createScreenState — module loading', () => {
    // Vitest resolves imports through Vite's transform, which papers over
    // CommonJS/ESM interop gaps. The API server runs under plain Node ESM
    // (tsx watch), where `@xterm/headless`'s CJS bundle exposes only a
    // `default` export — a named `import { Terminal }` crashes the process
    // at boot. Spawn real Node so that failure can never reach a server
    // start again.
    it('imports and constructs under real Node ESM (not just the Vitest transform)', async () => {
        const modulePath = resolve(HERE, 'terminal-screen-state.ts').replace(/\\/g, '/');
        const script = `import('file:///${modulePath}')
            .then((m) => { const s = m.createScreenState(80, 24); s.snapshot(); s.dispose(); })
            .catch((e) => { console.error(e.message); process.exit(1); });`;
        await expect(
            execFileP(process.execPath, ['--import', 'tsx', '-e', script], { timeout: 60_000 }),
        ).resolves.toBeDefined();
    }, 60_000);
});

describe('createScreenState', () => {
    it('renders SGR sequences split across feeds without zombie remnants', async () => {
        const state = createScreenState(80, 24);
        // Split exactly where a WS frame boundary used to garble the stream:
        // mid-way through a 256-color SGR introducer.
        await feedAsync(state, '\x1b[38;5;1');
        await feedAsync(state, '96mRED\x1b[0m\r\nnext');
        await flushAsync(state);

        const lines = await renderSnapshot(state.snapshot(), 80, 24);
        const text = lines.join('\n');
        expect(text).toContain('RED');
        expect(text).toContain('next');
        // The old byte-replay bug rendered the sequence tail as literal text.
        expect(text).not.toContain('8;5;196m');
        expect(text).not.toContain('[38;5;196m');
        state.dispose();
    });

    it('round-trips multi-byte characters without replacement chars', async () => {
        const state = createScreenState(80, 24);
        await feedAsync(state, '€ 你好 ┌─┐\r\n');
        await flushAsync(state);

        const lines = await renderSnapshot(state.snapshot(), 80, 24);
        const text = lines.join('\n');
        expect(text).toContain('€ 你好 ┌─┐');
        expect(text).not.toContain('�');
        state.dispose();
    });

    it('never emits device status queries in the snapshot', async () => {
        const state = createScreenState(80, 24);
        // A DSR cursor-position query embedded in TUI output. The old raw
        // replay forwarded this to every attaching browser, whose xterm
        // auto-answered it back into the PTY stdin (the ATTACH_SETTLE_MS hack).
        await feedAsync(state, 'before\x1b[6nafter\r\n');
        await flushAsync(state);

        const snapshot = state.snapshot();
        expect(snapshot).not.toContain('\x1b[6n');
        const lines = await renderSnapshot(snapshot, 80, 24);
        expect(lines.join('\n')).toContain('beforeafter');
        state.dispose();
    });

    it('fires feed and whenFlushed callbacks in FIFO order', async () => {
        const state = createScreenState(80, 24);
        const order: number[] = [];
        state.feed('a', () => order.push(1));
        state.whenFlushed(() => order.push(2));
        state.feed('b', () => order.push(3));
        state.whenFlushed(() => order.push(4));
        await flushAsync(state);
        expect(order).toEqual([1, 2, 3, 4]);
        state.dispose();
    });

    it('exposes no resize — mirror geometry is pinned for its lifetime', () => {
        // Geometry is pinned to TERMINAL_COLS x TERMINAL_ROWS across PTY,
        // mirror, and every browser pane; a resizable mirror would be a foot-
        // gun inviting the ConPTY reflow-divergence bug back in.
        const state = createScreenState(120, 30);
        expect('resize' in state).toBe(false);
        state.dispose();
    });

    it('is inert after dispose: no callbacks, empty snapshot, no throw', async () => {
        const state = createScreenState(80, 24);
        await feedAsync(state, 'hello');
        state.dispose();

        let fired = false;
        // Attach can race pause/exit disposal — post-dispose calls must be
        // silent no-ops, not crashes.
        expect(() => state.feed('late', () => { fired = true; })).not.toThrow();
        expect(() => state.whenFlushed(() => { fired = true; })).not.toThrow();
        expect(() => state.dispose()).not.toThrow();
        expect(state.snapshot()).toBe('');
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fired).toBe(false);
    });
});
