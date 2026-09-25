import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { environmentSecretsService } from './environment-secrets.js';
import { runNamedCommand } from './verification-gate.js';

// ADR 0020/0024. These spawn real bash against a real command rather than
// mocking `execFile`: the point of the gate is that an exit code is believed
// over a claim, and a mocked exit code would just be another claim.
//
// The command comes from a checker agent that read the repo, or from
// `project_repos.verify_command`. It never comes from a file in the worktree —
// the G-022 test below is what holds that line, and it predates the command
// model: a repository that ships its own `.atlas/scripts/...` must not get it
// executed just because it sits where Atlas used to look.
const posix = process.platform !== 'win32';

let repoPath: string;

const NO_SECRETS_PROJECT = 'project-that-does-not-exist';
const run = (command: string) => runNamedCommand({ repoPath, projectId: NO_SECRETS_PROJECT, command });

beforeEach(async () => {
    await truncateAll();
    repoPath = mkdtempSync(join(tmpdir(), 'atlas-gate-test-'));
});
afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
});
afterAll(async () => {
    await closeTestDb();
});

describe.skipIf(!posix)('runNamedCommand', () => {
    it('passes when the command exits 0', async () => {
        expect(await run('exit 0')).toEqual({ kind: 'pass' });
    });

    // "I checked and it is fine" and "there was nothing I could check" are both
    // exit 0 and both take the pass edge, and they mean opposite things. On
    // ATL-110 a red suite reached the end of a run behind four `pass` rows, two
    // of which were skips. The verdict has to say which happened.
    it('reports skipped — NOT pass — when the command says it had nothing to check', async () => {
        expect(await run('echo "visual: skipped - no snapshot tooling here"')).toEqual({
            kind: 'skipped',
            output: 'visual: skipped - no snapshot tooling here',
        });
    });

    it('still reports pass when a passing command says something that is not a skip', async () => {
        expect(await run('echo "perf: within budget"')).toEqual({
            kind: 'pass',
            output: 'perf: within budget',
        });
    });

    it('treats a silent exit 0 as pass, not skipped', async () => {
        expect(await run('true')).toEqual({ kind: 'pass' });
    });

    it('does not mistake the word "skipped" later in the output for a skip', async () => {
        expect((await run('printf "hygiene: clean\\n3 tests skipped\\n"')).kind).toBe('pass');
    });

    it('fails when the command exits non-zero, and reports what it printed', async () => {
        const res = await run('printf "FAIL src/thing.test.ts\\n  1 failed\\n"; exit 1');
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('1 failed');
    });

    it('captures stderr too — a failing suite often writes there', async () => {
        const res = await run('echo "boom" >&2; exit 2');
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('boom');
    });

    // A command can downgrade its own failure to "a human should look at this"
    // — a missing visual baseline is the case it exists for. Opt-in by a
    // sentinel rather than a reserved exit code, because 2 is a generic failure
    // for a great many tools.
    it('reports needs_review when the failing command prints the sentinel', async () => {
        const res = await run('echo ATLAS_GATE_NEEDS_REVIEW; echo "no baseline yet"; exit 1');
        expect(res.kind).toBe('needs_review');
        if (res.kind !== 'needs_review') throw new Error('unreachable');
        expect(res.output).toContain('no baseline yet');
    });

    it('never turns an exit 0 into needs_review', async () => {
        expect((await run('echo ATLAS_GATE_NEEDS_REVIEW; exit 0')).kind).toBe('pass');
    });

    it('runs nothing at all for an empty command', async () => {
        expect(await run('   ')).toEqual({ kind: 'unavailable', reason: 'no command to run' });
    });

    it('ignores a script the REPOSITORY planted at the staged path (G-022)', async () => {
        // The attack the fix exists for. The gate once executed whatever sat at
        // that path, with cwd = the repo and the parent's env. Nothing reads
        // that path any more, and nothing may start again.
        const dir = join(repoPath, '.atlas', 'scripts', 'bash');
        mkdirSync(dir, { recursive: true });
        const marker = join(repoPath, 'PWNED');
        writeFileSync(join(dir, 'check-coder-tests-green.sh'), `#!/usr/bin/env bash\ntouch ${marker}\nexit 0\n`, {
            mode: 0o755,
        });
        const res = await run('echo "the named command ran"; exit 1');
        expect(res.kind).toBe('fail');
        expect(existsSync(marker), 'the repo-planted script executed').toBe(false);
    });

    it('reports unavailable — NOT fail — when the command times out', async () => {
        const prev = process.env['ATLAS_GATE_TIMEOUT_MS'];
        process.env['ATLAS_GATE_TIMEOUT_MS'] = '300';
        try {
            const res = await run('sleep 30');
            expect(res.kind).toBe('unavailable');
            if (res.kind !== 'unavailable') throw new Error('unreachable');
            expect(res.reason).toContain('timed out');
        } finally {
            if (prev === undefined) delete process.env['ATLAS_GATE_TIMEOUT_MS'];
            else process.env['ATLAS_GATE_TIMEOUT_MS'] = prev;
        }
    });

    // A caveat worth pinning rather than pretending away: a missing binary
    // INSIDE the shell is exit 127, which is a numeric exit code and therefore
    // reads as `fail`, not `unavailable`. Only a failure to spawn bash itself
    // is `unavailable`. That is the right trade — a checker is told to name
    // only tooling the project already has, and treating every non-zero as
    // "could not check" would be the unenforced gate ADR 0020 exists to stop —
    // but it means a checker that names a global it assumed would be installed
    // sends the fixer after a command-not-found.
    it('reports a missing binary as a failure, with the shell error in the output', async () => {
        const res = await run('atlas-no-such-binary --version');
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toMatch(/not found|No such file/i);
    });

    it('runs a shell line, so && and pipes work as the checker wrote them', async () => {
        expect((await run('true && echo one | grep -q one')).kind).toBe('pass');
        expect((await run('false && echo one')).kind).toBe('fail');
    });

    it("runs with the repo as cwd, so it sees that repo's manifest", async () => {
        // ADR 0017 — each repo of a Task has its own suite. The wrong cwd
        // would test a sibling and report on the wrong code.
        writeFileSync(join(repoPath, 'marker-file'), 'x');
        expect((await run('test -f marker-file')).kind).toBe('pass');
    });

    it('does not hand the parent process environment to the command (G-021)', async () => {
        // This is the control that makes running an LLM-named string safe to
        // persist. The API process holds DATABASE_URL (with a password) and
        // ATLAS_MCP_TOKEN, `redactSecretValues` masks neither, and this output
        // is stored on the run and posted on the item.
        const res = await run('echo "DB=[${DATABASE_URL:-unset}]"; exit 1');
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output).toContain('DB=[unset]');
    });

    it('still passes PATH through, or nothing would run at all', async () => {
        expect((await run('test -n "$PATH"')).kind).toBe('pass');
    });

    it('withholds output entirely when the secret set cannot be loaded', async () => {
        const spy = vi
            .spyOn(environmentSecretsService, 'decryptAll')
            .mockRejectedValueOnce(new Error('workspace key unreadable'));
        try {
            const res = await run('echo "ghp_realtokenvalue"; exit 1');
            expect(res.kind).toBe('fail');
            if (res.kind !== 'fail') throw new Error('unreachable');
            expect(res.output).toContain('output withheld');
            expect(res.output).not.toContain('ghp_realtokenvalue');
        } finally {
            spy.mockRestore();
        }
    });

    it('truncates a very long failure to its tail', async () => {
        const res = await run('for i in $(seq 1 3000); do echo "line $i padding padding"; done; exit 1');
        expect(res.kind).toBe('fail');
        if (res.kind !== 'fail') throw new Error('unreachable');
        expect(res.output.length).toBeLessThanOrEqual(4000);
        expect(res.output).toContain('line 3000');
    });

    it('leaves nothing behind in the worktree', async () => {
        // The wrapper is written to a 0600 tmpfile outside the repo and
        // unlinked; a stray script in the checkout would be committed by
        // `commitPending` and end up in the pull request.
        await run('true');
        expect(existsSync(join(repoPath, '.atlas'))).toBe(false);
    });
});
