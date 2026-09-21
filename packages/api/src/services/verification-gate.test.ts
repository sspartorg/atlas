import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environmentSecretsService } from './environment-secrets.js';
import { runVerificationGate, gateScriptPath } from './verification-gate.js';

// ADR 0020. These tests spawn real bash against real scripts on disk rather
// than mocking `execFile`, because the whole point of the gate is that an exit
// code is believed over a claim — a mocked exit code would be another claim.
//
// Windows takes the powershell branch; skip there rather than assert a shape
// the platform never produces.
const posix = process.platform !== 'win32';

let repoPath: string;

function stageScript(body: string): void {
    const dir = join(repoPath, '.atlas', 'scripts', 'bash');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'check-coder-tests-green.sh'), body, { encoding: 'utf8', mode: 0o755 });
}

// No project row exists for this id, so the secret lookup resolves to an empty
// set and redaction is a no-op — which is what lets these tests assert on the
// script's raw output. Redaction itself is covered by the setup runner's own
// tests; this module shares that exact function.
const NO_SECRETS_PROJECT = 'project-that-does-not-exist';

const run = () =>
    runVerificationGate({ repoPath, projectId: NO_SECRETS_PROJECT, itemId: 'ATL-1' });

beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'atlas-gate-test-'));
});

afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
});

describe.skipIf(!posix)('runVerificationGate', () => {
    it('passes when the staged script exits 0', async () => {
        stageScript('#!/usr/bin/env bash\nexit 0\n');
        expect(await run()).toEqual({ kind: 'pass' });
    });

    it('fails when the script exits non-zero, and reports what it printed', async () => {
        // The shape the real coder-tests-green script produces on a red suite.
        stageScript('#!/usr/bin/env bash\nprintf "coder-tests-green:\\n  test script failed\\n"\nexit 1\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('test script failed');
    });

    it('captures stderr too — a failing suite often writes there', async () => {
        stageScript('#!/usr/bin/env bash\necho "boom" >&2\nexit 2\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('boom');
    });

    // ─── The distinction ADR 0020 turns on ──────────────────────────────────
    //
    // "Could not run" is absence of evidence, not evidence of a red suite.
    // Every case below must report `unavailable` so the run parks with the
    // Owner. If any of them ever returns `fail`, a missing binary or a torn-down
    // worktree starts blocking delivery for a suite that may well be green.

    it('reports unavailable — NOT fail — when no script is staged', async () => {
        const res = await run();
        expect(res.kind).toBe('unavailable');
        if (res.kind !== 'unavailable') throw new Error('unreachable');
        expect(res.reason).toContain('no verification script');
    });

    it('reports unavailable when the worktree is gone entirely', async () => {
        rmSync(repoPath, { recursive: true, force: true });
        expect((await run()).kind).toBe('unavailable');
    });

    it('reports unavailable — NOT fail — when the gate times out', async () => {
        stageScript('#!/usr/bin/env bash\nsleep 30\n');
        const prev = process.env['ATLAS_GATE_TIMEOUT_MS'];
        process.env['ATLAS_GATE_TIMEOUT_MS'] = '300';
        try {
            const res = await run();
            expect(res.kind).toBe('unavailable');
            if (res.kind !== 'unavailable') throw new Error('unreachable');
            expect(res.reason).toContain('timed out');
        } finally {
            if (prev === undefined) delete process.env['ATLAS_GATE_TIMEOUT_MS'];
            else process.env['ATLAS_GATE_TIMEOUT_MS'] = prev;
        }
    });

    it('passes --run-tests, which is what makes the script run the suite', async () => {
        // Without the flag the script stops at typecheck and lint, so a reviewer
        // step would once again never execute the tests it claims are green.
        stageScript('#!/usr/bin/env bash\n[ "$2" = "--run-tests" ] || exit 3\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it('runs the script with the repo as cwd, so it sees that repo\'s manifest', async () => {
        // ADR 0017 — a Task spans repos and each has its own suite. Running in
        // the wrong cwd would test a sibling and report on the wrong code.
        writeFileSync(join(repoPath, 'marker-file'), 'x');
        stageScript('#!/usr/bin/env bash\n[ -f marker-file ] || exit 4\nexit 0\n');
        expect((await run()).kind).toBe('pass');
    });

    it('withholds output entirely when the secret set cannot be loaded', async () => {
        // Masking is the only thing standing between a failing test that
        // echoes an env var and that value landing in the persisted run log.
        // If the secret set is unavailable we cannot mask, so we do not
        // publish — a withheld message is recoverable, a leaked token is not.
        stageScript('#!/usr/bin/env bash\necho "ghp_realtokenvalue"\nexit 1\n');
        const spy = vi
            .spyOn(environmentSecretsService, 'decryptAll')
            .mockRejectedValueOnce(new Error('workspace key unreadable'));
        try {
            const res = await run();
            expect(res.kind).toBe('fail');
            if (res.kind !== 'fail') throw new Error('unreachable');
            expect(res.output).toContain('output withheld');
            expect(res.output).not.toContain('ghp_realtokenvalue');
        } finally {
            spy.mockRestore();
        }
    });

    it('does not depend on the script carrying the execute bit', async () => {
        // Written while trying to force the spawn-failure branch by dropping
        // +x, which does not work and is worth recording: the gate invokes
        // `bash <path>`, so bash reads the file and the mode is irrelevant.
        // constitution-assembler writes 0755, but the gate does not rely on
        // it — a umask that strips +x cannot silently disable verification.
        const dir = join(repoPath, '.atlas', 'scripts', 'bash');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'check-coder-tests-green.sh'), 'exit 0\n', { mode: 0o644 });
        expect((await run()).kind).toBe('pass');
    });

    it('truncates a very long failure to its tail', async () => {
        stageScript('#!/usr/bin/env bash\nfor i in $(seq 1 3000); do echo "line $i padding padding"; done\nexit 1\n');
        const res = await run();
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output.length).toBeLessThanOrEqual(4000);
        // The tail is the useful end of a suite log, so the last line survives.
        expect(res.output).toContain('line 3000');
    });
});

describe('gateScriptPath', () => {
    it('points at the path constitution-assembler stages scripts to', () => {
        // Coupled on purpose: if the assembler's layout changes, the gate
        // silently reports `unavailable` forever and nothing is ever verified.
        const p = gateScriptPath('/tmp/wt');
        expect(p).toContain(join('.atlas', 'scripts'));
        expect(p).toContain('check-coder-tests-green');
    });
});
