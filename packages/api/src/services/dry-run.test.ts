// Tests for dry-run.ts — CLI connection test service.
// startDryRun is nearly all side-effects (SSE broadcast + fire-and-forget
// subprocess spawn). The testable surface is:
//   1. Return shape (dryRunId, model, cli, promptLen).
//   2. The immediate dry_run_started SSE event.
//   3. promptLen math (buildDryRunPrompt is not exported but drives promptLen).
//
// The subprocess is spawned inside a 50ms setTimeout (fire-and-forget).
// We do NOT advance the timer here — we return before it fires, so no
// subprocess mock is needed for the return-value / SSE-event tests.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── SSE broadcast mock ──────────────────────────────────────────────────────
const mockBroadcastSSE = vi.hoisted(() => vi.fn());
vi.mock('../routes/events.js', () => ({
    broadcastSSE: mockBroadcastSSE,
}));

// ── child_process mock (preventive — needed when timers fire in other tests) ─
vi.mock('child_process', () => ({
    spawn: vi.fn(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        stdin: { write: vi.fn(), end: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
    })),
}));

// ── cli-model-naming mock ────────────────────────────────────────────────────
vi.mock('./cli-model-naming.js', () => ({
    normalizeModelForCli: vi.fn((model: string) => model),
    resolveSpawn: vi.fn((cmd: string, args: string[]) => ({
        command: cmd,
        args,
        useShell: false,
    })),
}));

import { startDryRun } from './dry-run.js';
import type { IAgent } from '@atlas/shared';

// Minimal agent with only the fields dry-run.ts actually reads.
const MOCK_AGENT = {
    id: 'agent-test',
    cli: 'claude',
    model: 'claude-opus-4-7',
} as unknown as IAgent;

beforeEach(() => {
    vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// Return value shape
// ──────────────────────────────────────────────────────────────────────────────

describe('startDryRun — return value', () => {
    it('returns a RFC-4122 UUID for dryRunId', async () => {
        const result = await startDryRun(MOCK_AGENT, null);
        expect(result.dryRunId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    it('returns agent model and cli unchanged', async () => {
        const result = await startDryRun(MOCK_AGENT, null);
        expect(result.model).toBe('claude-opus-4-7');
        expect(result.cli).toBe('claude');
    });

    it('promptLen is positive', async () => {
        const result = await startDryRun(MOCK_AGENT, null);
        expect(result.promptLen).toBeGreaterThan(0);
    });

    it('falls back to "sonnet" when agent.model is empty string', async () => {
        const agent = { ...MOCK_AGENT, model: '' } as unknown as IAgent;
        const result = await startDryRun(agent, null);
        expect(result.model).toBe('sonnet');
    });

    it('returns cli=copilot for copilot agents', async () => {
        const copilot = { ...MOCK_AGENT, cli: 'copilot', model: 'claude-sonnet-4.6' } as unknown as IAgent;
        const result = await startDryRun(copilot, null);
        expect(result.cli).toBe('copilot');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Prompt length (buildDryRunPrompt logic via promptLen)
// ──────────────────────────────────────────────────────────────────────────────

const PING = 'Reply with the single word OK and nothing else.';

describe('startDryRun — promptLen / buildDryRunPrompt', () => {
    it('without extra, promptLen equals the base ping length', async () => {
        const result = await startDryRun(MOCK_AGENT, null);
        expect(result.promptLen).toBe(PING.length);
    });

    it('with extra, promptLen = base + 2 newlines + trimmed extra', async () => {
        const extra = 'What is 2+2?';
        const result = await startDryRun(MOCK_AGENT, extra);
        // buildDryRunPrompt returns ['ping', '', extra].join('\n') = ping + '\n\n' + extra
        expect(result.promptLen).toBe(PING.length + 2 + extra.length);
    });

    it('trims whitespace around the extra prompt before counting', async () => {
        const padded = '   What is 2+2?   ';
        const bare = 'What is 2+2?';
        const paddedResult = await startDryRun(MOCK_AGENT, padded);
        const bareResult = await startDryRun(MOCK_AGENT, bare);
        expect(paddedResult.promptLen).toBe(bareResult.promptLen);
    });

    it('empty-string extra is treated as no extra', async () => {
        const resultEmpty = await startDryRun(MOCK_AGENT, '');
        const resultNull = await startDryRun(MOCK_AGENT, null);
        expect(resultEmpty.promptLen).toBe(resultNull.promptLen);
    });

    it('whitespace-only extra is treated as no extra', async () => {
        const resultSpaces = await startDryRun(MOCK_AGENT, '   ');
        const resultNull = await startDryRun(MOCK_AGENT, null);
        expect(resultSpaces.promptLen).toBe(resultNull.promptLen);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// SSE — dry_run_started broadcast
// ──────────────────────────────────────────────────────────────────────────────

describe('startDryRun — dry_run_started SSE event', () => {
    it('broadcasts dry_run_started before returning', async () => {
        await startDryRun(MOCK_AGENT, null);
        expect(mockBroadcastSSE).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'dry_run_started' }),
        );
    });

    it('dry_run_started event carries dryRunId, agentId', async () => {
        const result = await startDryRun(MOCK_AGENT, null);
        const startCall = mockBroadcastSSE.mock.calls.find(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_started',
        );
        expect(startCall).toBeDefined();
        const evt = startCall![0] as { type: string; dryRunId: string; agentId: string };
        expect(evt.dryRunId).toBe(result.dryRunId);
        expect(evt.agentId).toBe('agent-test');
    });

    it('dry_run_started output line mentions cli and model', async () => {
        await startDryRun(MOCK_AGENT, null);
        const startCall = mockBroadcastSSE.mock.calls.find(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_started',
        );
        const evt = startCall![0] as { type: string; output: string };
        expect(evt.output).toContain('claude');
        expect(evt.output).toContain('claude-opus-4-7');
    });

    it('each call produces a unique dryRunId', async () => {
        const r1 = await startDryRun(MOCK_AGENT, null);
        const r2 = await startDryRun(MOCK_AGENT, null);
        expect(r1.dryRunId).not.toBe(r2.dryRunId);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// spawnDryRunCli internal branches (via fake timers + mock inspection)
// ──────────────────────────────────────────────────────────────────────────────

import { spawn as nodeSpawn } from 'child_process';

describe('spawnDryRunCli — spawn error branch (resolveSpawn throws)', () => {
    it('broadcasts dry_run_done with exitCode=-1 when resolveSpawn throws', async () => {
        vi.useFakeTimers();
        const { resolveSpawn: mockResolveSpawn } = await import('./cli-model-naming.js');
        vi.mocked(mockResolveSpawn).mockImplementationOnce(() => {
            throw new Error('binary not found');
        });

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100); // fire the 50ms setTimeout

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number; output: string };
        expect(doneEvt.exitCode).toBe(-1);
        expect(doneEvt.output).toContain('binary not found');

        vi.useRealTimers();
    });
});

describe('spawnDryRunCli — close event branch (exit code 0)', () => {
    it('broadcasts dry_run_done with connection ok when process exits 0', async () => {
        vi.useFakeTimers();

        let closeCallback: ((code: number | null) => void) | undefined;
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event: string, cb: (code: number | null) => void) => {
                if (event === 'close') closeCallback = cb;
            }),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        // fire the close event with exit code 0
        if (closeCallback) closeCallback(0);

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number; output: string };
        expect(doneEvt.exitCode).toBe(0);
        expect(doneEvt.output).toContain('connection ok');

        vi.useRealTimers();
    });

    it('broadcasts dry_run_done with connection failed when process exits non-zero', async () => {
        vi.useFakeTimers();

        let closeCallback: ((code: number | null) => void) | undefined;
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event: string, cb: (code: number | null) => void) => {
                if (event === 'close') closeCallback = cb;
            }),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        if (closeCallback) closeCallback(1);

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number; output: string };
        expect(doneEvt.exitCode).toBe(1);
        expect(doneEvt.output).toContain('connection failed');

        vi.useRealTimers();
    });

    it('coerces null exit code to -1 (code ?? -1 branch)', async () => {
        vi.useFakeTimers();

        let closeCallback: ((code: number | null) => void) | undefined;
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event: string, cb: (code: number | null) => void) => {
                if (event === 'close') closeCallback = cb;
            }),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        if (closeCallback) closeCallback(null);

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number };
        expect(doneEvt.exitCode).toBe(-1);

        vi.useRealTimers();
    });
});

describe('spawnDryRunCli — error event branch', () => {
    it('broadcasts dry_run_done on child error event', async () => {
        vi.useFakeTimers();

        let errorCallback: ((err: Error) => void) | undefined;
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event: string, cb: ((err: Error) => void) | ((code: number | null) => void)) => {
                if (event === 'error') errorCallback = cb as (err: Error) => void;
            }),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        if (errorCallback) errorCallback(new Error('ENOENT child error'));

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number; output: string };
        expect(doneEvt.exitCode).toBe(-1);
        expect(doneEvt.output).toContain('ENOENT child error');

        vi.useRealTimers();
    });
});

describe('spawnDryRunCli — stdin write error branch', () => {
    it('broadcasts dry_run_done when stdin.write throws', async () => {
        vi.useFakeTimers();

        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: {
                write: vi.fn(() => {
                    throw new Error('stdin write failed');
                }),
                end: vi.fn(),
            },
            on: vi.fn(),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        const doneCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_done',
        );
        expect(doneCalls.length).toBeGreaterThanOrEqual(1);
        const doneEvt = doneCalls[0]![0] as { exitCode: number; output: string };
        expect(doneEvt.exitCode).toBe(-1);
        expect(doneEvt.output).toContain('stdin write failed');

        vi.useRealTimers();
    });
});

describe('spawnDryRunCli — copilot args branch (no stdin.write)', () => {
    it('does not write to stdin for copilot (prompt is in -p flag)', async () => {
        vi.useFakeTimers();

        const stdinWriteSpy = vi.fn();
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: stdinWriteSpy, end: vi.fn() },
            on: vi.fn(),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        const copilotAgent = { ...MOCK_AGENT, cli: 'copilot' } as unknown as IAgent;
        await startDryRun(copilotAgent, null);
        vi.advanceTimersByTime(100);

        // For copilot, stdin.write should NOT be called (prompt in -p arg)
        expect(stdinWriteSpy).not.toHaveBeenCalled();

        vi.useRealTimers();
    });
});

describe('spawnDryRunCli — emitOutput line filtering (empty line branch)', () => {
    it('stdout data event with empty lines: empty lines are NOT broadcast (emitOutput guard)', async () => {
        vi.useFakeTimers();

        let stdoutDataCallback: ((chunk: Buffer) => void) | undefined;
        const mockChild = {
            stdout: { on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
                if (event === 'data') stdoutDataCallback = cb;
            }) },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn(),
            kill: vi.fn(),
        };
        vi.mocked(nodeSpawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => mockChild);

        await startDryRun(MOCK_AGENT, null);
        vi.advanceTimersByTime(100);

        // Clear broadcasts from startup; then trigger stdout data
        mockBroadcastSSE.mockClear();

        // Send data with empty lines mixed in
        if (stdoutDataCallback) {
            stdoutDataCallback(Buffer.from('\nHello\n\nWorld\n'));
        }

        const outputCalls = mockBroadcastSSE.mock.calls.filter(
            ([evt]: [{ type: string }]) => evt.type === 'dry_run_output',
        );
        // Only non-empty lines should be broadcast (Hello, World)
        expect(outputCalls.length).toBe(2);
        const outputs = outputCalls.map(([evt]: [{ output: string }]) => evt.output);
        expect(outputs).toContain('Hello');
        expect(outputs).toContain('World');

        vi.useRealTimers();
    });
});
