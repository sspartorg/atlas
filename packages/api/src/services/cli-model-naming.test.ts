import { describe, it, expect } from 'vitest';
import { normalizeModelForCli, quoteArgsForShell, resolveSpawn } from './cli-model-naming.js';

// Workstream #4 — `normalizeModelForCli` is no longer a rewriter; the
// agent row's `model` is in the CLI-correct form thanks to the FK on
// `agents (cli, model) → cli_models (cli, model_name)`. The function
// just passes through and supplies a fallback for null/undefined.
describe('normalizeModelForCli', () => {
    it('passes Claude CLI models through unchanged', () => {
        expect(normalizeModelForCli('claude-sonnet-4-6', 'claude')).toBe('claude-sonnet-4-6');
    });

    it('passes Copilot CLI models through unchanged (no more hyphen→dot rewrite)', () => {
        expect(normalizeModelForCli('claude-sonnet-4.6', 'copilot')).toBe('claude-sonnet-4.6');
        expect(normalizeModelForCli('claude-opus-4.7', 'copilot')).toBe('claude-opus-4.7');
        expect(normalizeModelForCli('gpt-5.2', 'copilot')).toBe('gpt-5.2');
    });

    it('passes Ollama models through unchanged, `name:tag` form included', () => {
        expect(normalizeModelForCli('qwen3.5', 'ollama')).toBe('qwen3.5');
        expect(normalizeModelForCli('kimi-k2.7-code:cloud', 'ollama')).toBe('kimi-k2.7-code:cloud');
    });

    it('falls back to a sensible default when the model is missing', () => {
        expect(normalizeModelForCli(null, 'claude')).toBe('sonnet');
        expect(normalizeModelForCli(undefined, 'copilot')).toBe('gpt-5');
        expect(normalizeModelForCli(null, 'ollama')).toBe('qwen3.5');
    });

    it('does not promote a null-model claude row to the Opus default', () => {
        // The fallback map is deliberately separate from DEFAULT_MODEL_BY_CLI.
        // Sharing them would silently upgrade legacy null-model rows from
        // Sonnet to Opus — a real cost change smuggled in behind a refactor.
        expect(normalizeModelForCli(null, 'claude')).not.toBe('claude-opus-4-7');
    });
});

describe('quoteArgsForShell', () => {
    it('returns args unmodified on non-Windows', () => {
        // Direct call (mocking process.platform is brittle); only sanity-check
        // the no-quote branch which fires identically across platforms.
        const trivial = ['a', 'b', '--flag'];
        // Whitespace-containing args round-trip with quotes only on win32.
        // Either way, identity-preserving for the trivial case.
        expect(quoteArgsForShell(trivial)).toEqual(trivial);
    });

    it('takes the early-return branch when process.platform is stubbed to non-win32', () => {
        // This test suite runs on win32, so `quoteArgsForShell`'s
        // `process.platform !== 'win32'` early-return branch is otherwise
        // never exercised. Stub `process.platform` (configurable on
        // Node) to hit the POSIX path explicitly, then restore it.
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        try {
            // Args with spaces/metachars would be quoted on win32; on the
            // stubbed POSIX branch they pass through untouched.
            expect(quoteArgsForShell(['has space', 'a|b'])).toEqual(['has space', 'a|b']);
        } finally {
            Object.defineProperty(process, 'platform', original);
        }
    });

    it('quotes whitespace and metacharacters on win32 (skipped on POSIX)', () => {
        if (process.platform !== 'win32') return;
        // Empty string becomes "".
        expect(quoteArgsForShell([''])).toEqual(['""']);
        // Alphanumeric stays bare.
        expect(quoteArgsForShell(['plain'])).toEqual(['plain']);
        // Whitespace forces quotes.
        expect(quoteArgsForShell(['has space'])).toEqual(['"has space"']);
        // Embedded double-quote → escaped as "".
        expect(quoteArgsForShell(['a"b'])).toEqual(['"a""b"']);
        // Shell metachar forces quotes.
        expect(quoteArgsForShell(['a|b'])).toEqual(['"a|b"']);
    });
});

describe('resolveSpawn (Windows shim → node entry)', () => {
    // Three real outcomes, and which one you get depends on the machine, not
    // on the code under test. The previous version of this test asserted the
    // shim-resolved branch unconditionally on Windows — i.e. it silently
    // required the copilot CLI to be INSTALLED, and failed on any dev box
    // without it. Assert the contract of whichever branch actually ran.
    it('returns a spawn-ready shape for every resolution outcome', () => {
        const r = resolveSpawn('copilot', ['-p', 'hello']);

        if (r.command === process.execPath) {
            // Shim resolved (Windows, copilot installed) → spawn node directly
            // on the resolved entry, no shell, original argv preserved after it.
            expect(r.useShell).toBe(false);
            expect(r.args[0]).toMatch(/npm-loader\.js$|copilot.*\.js$/i);
            expect(r.args.slice(1)).toEqual(['-p', 'hello']);
        } else {
            // No shim → the bin is passed through untouched. Windows still
            // needs the shell (that is how a bare `copilot` resolves a .cmd
            // on PATH); POSIX does not.
            expect(r.command).toBe('copilot');
            expect(r.useShell).toBe(process.platform === 'win32');
            expect(r.args).toEqual(quoteArgsForShell(['-p', 'hello']));
        }
    });

    it('falls back to the shell path when the bin has no .cmd shim', () => {
        const r = resolveSpawn('this-binary-does-not-exist-atlas-test', ['x']);
        if (process.platform === 'win32') {
            // `where.exe` fails → fall back to bin + shell:true. quoteArgsForShell
            // leaves bare alphanumerics untouched, so args round-trip identity.
            expect(r.command).toBe('this-binary-does-not-exist-atlas-test');
            expect(r.useShell).toBe(true);
            expect(r.args).toEqual(['x']);
        } else {
            expect(r.command).toBe('this-binary-does-not-exist-atlas-test');
            expect(r.useShell).toBe(false);
        }
    });

    it('the fallback shape uses useShell=false when process.platform is stubbed to non-win32', () => {
        // This suite runs on win32, so the `useShell: process.platform ===
        // 'win32'` ternary in the fallback return only ever evaluates
        // true here. Stub the platform to hit the false side explicitly.
        // `resolveCliShim` also short-circuits to null on non-win32 (its
        // own early return, already ignored via v8-ignore), so the
        // fallback path is what runs regardless of bin.
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        try {
            const r = resolveSpawn('this-binary-does-not-exist-atlas-test', ['x']);
            expect(r.useShell).toBe(false);
            expect(r.command).toBe('this-binary-does-not-exist-atlas-test');
            expect(r.args).toEqual(['x']);
        } finally {
            Object.defineProperty(process, 'platform', original);
        }
    });
});
