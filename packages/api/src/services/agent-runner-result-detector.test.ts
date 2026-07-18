import { describe, expect, it } from 'vitest';
import { detectCliResultLine } from './agent-runner.js';

// 2026-06-02 — Windows zombie-grandchild guard. The Claude/Copilot
// CLIs emit a single `{"type":"result"}` NDJSON line as their
// authoritative completion signal. On Windows, a Bash-tool subprocess
// that leaks a hung grandchild (e.g. the architect's failed `specify
// init`) can keep the CLI's inherited stdio pipes open AFTER the
// result line is printed, preventing Node's `child.on('close')` from
// ever firing. `detectCliResultLine` parses the per-line stream so the
// runner can start a grace timer + force-finalize after seeing it,
// instead of waiting for an OS-level exit that never arrives.

describe('detectCliResultLine', () => {
    it('returns success on Claude stream-json result line with subtype="success"', () => {
        const line = JSON.stringify({
            type: 'result',
            subtype: 'success',
            total_cost_usd: 1.5,
            terminal_reason: 'completed',
        });
        expect(detectCliResultLine(line)).toEqual({ subtype: 'success' });
    });

    it('returns error on Claude stream-json result line with subtype="error"', () => {
        const line = JSON.stringify({
            type: 'result',
            subtype: 'error',
            terminal_reason: 'error',
        });
        expect(detectCliResultLine(line)).toEqual({ subtype: 'error' });
    });

    it('returns success on Copilot json result line with exitCode=0', () => {
        const line = JSON.stringify({
            type: 'result',
            exitCode: 0,
            usage: { premiumRequests: 2 },
        });
        expect(detectCliResultLine(line)).toEqual({ subtype: 'success' });
    });

    it('returns error on Copilot json result line with exitCode≠0', () => {
        const line = JSON.stringify({ type: 'result', exitCode: 2 });
        expect(detectCliResultLine(line)).toEqual({ subtype: 'error' });
    });

    it('returns null for non-result lines (assistant message)', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'hello' }] },
        });
        expect(detectCliResultLine(line)).toBeNull();
    });

    it('returns null for system init lines', () => {
        const line = JSON.stringify({ type: 'system', subtype: 'init' });
        expect(detectCliResultLine(line)).toBeNull();
    });

    it('returns null for stderr-prefixed lines (already-non-JSON)', () => {
        expect(detectCliResultLine('[stderr] git push: connection refused')).toBeNull();
    });

    it('returns null for malformed JSON (does not throw)', () => {
        expect(detectCliResultLine('{"type":"result", broken'))
            .toBeNull();
    });

    it('returns null for empty / whitespace lines', () => {
        expect(detectCliResultLine('')).toBeNull();
        expect(detectCliResultLine('   ')).toBeNull();
    });

    it('returns null when type is missing even if subtype="success" is present', () => {
        const line = JSON.stringify({ subtype: 'success' });
        expect(detectCliResultLine(line)).toBeNull();
    });

    it('fast-path: skips JSON.parse when the line does not contain "result"', () => {
        // Cheap pre-check; covered implicitly by the assistant-message test
        // above, but explicit here so a future refactor that removes the
        // pre-check would break the test on a real-world long stream line.
        const longLine = '{"type":"assistant","message":{"content":[{"type":"text","text":"' + 'a'.repeat(2000) + '"}]}}';
        expect(detectCliResultLine(longLine)).toBeNull();
    });
});
