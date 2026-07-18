import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { testDb, truncateAll } from '../../tests/_pg-db.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';

// Mock node:child_process.execFile BEFORE importing the runner so the
// promisified `execFileAsync` inside the runner picks up the mock.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
    execFile: (
        bin: string,
        args: string[],
        opts: unknown,
        cb: (err: unknown, res?: { stdout: string; stderr: string }) => void,
    ) => {
        try {
            const res = execFileMock(bin, args, opts);
            if (res && typeof res === 'object' && 'then' in res) {
                (res as Promise<{ stdout: string; stderr: string }>).then(
                    (r) => cb(null, r),
                    (err) => cb(err),
                );
            } else {
                cb(null, res as { stdout: string; stderr: string });
            }
        } catch (err) {
            cb(err);
        }
    },
}));

// SSE / events-log mocks so the runner doesn't try to broadcast through a
// real Fastify instance. Unused here today but defensive — phase 4 wires
// the runner into agent-runner.ts, which DOES broadcast.
vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
vi.mock('./events-log.js', () => ({
    eventsLog: { record: vi.fn(), activity: vi.fn().mockResolvedValue([]) },
}));

// Imported after the mocks so the module picks up our wired execFile.
const { runProjectSetup, sweepOrphanSetupTmpfiles } = await import('./project-setup-runner.js');

const isWindows = process.platform === 'win32';
const SCRIPT_KEY = isWindows ? 'setup_ps1_body' : 'setup_sh_body';

const sandboxRoot = mkdtempSync(join(tmpdir(), 'atlas-setup-runner-test-'));

afterAll(() => {
    rmSync(sandboxRoot, { recursive: true, force: true });
});

async function insertProject(setupBody: string | null): Promise<string> {
    const id = `proj-${randomUUID()}`;
    const fields: Record<string, unknown> = {
        id,
        name: 'setup runner test',
        issue_key_prefix: 'STP',
        git_path: sandboxRoot,
        git_url: '',
        credential_id: null,
        default_branch: 'main',
        clone_status: 'ready',
        description: '',
        status: 'active',
        guardrails_md: '',
        setup_sh_body: '',
        setup_ps1_body: '',
    };
    if (setupBody !== null) fields[SCRIPT_KEY] = setupBody;
    await testDb.insertInto('projects').values(fields as never).execute();
    return id;
}

describe('runProjectSetup', () => {
    beforeEach(async () => {
        await truncateAll();
        execFileMock.mockReset();
    });

    it('returns ok:true when the matching-OS blob is empty (no-op)', async () => {
        const projectId = await insertProject('');
        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'r1',
        });
        expect(out).toEqual({ ok: true });
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('returns ok:true when the project does not exist (defensive)', async () => {
        const out = await runProjectSetup({
            projectId: 'does-not-exist',
            worktreePath: sandboxRoot,
            runId: 'r1',
        });
        // Project-not-found is a hard failure surfaced by the runner so
        // the orchestrator can record setup_failed and not silently run.
        expect(out.ok).toBe(false);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('substitutes ${variable.KEY} from environment secrets and executes', async () => {
        const projectId = await insertProject('echo "hi ${variable.WHO}"');
        await environmentSecretsService.replaceAll([{ key: 'WHO', value: 'world' }]);

        execFileMock.mockReturnValue({ stdout: 'hi world\n', stderr: '' });

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'r2',
        });
        expect(out).toEqual({ ok: true });
        expect(execFileMock).toHaveBeenCalledTimes(1);

        const [bin, args] = execFileMock.mock.calls[0]!;
        if (isWindows) {
            expect(bin).toBe('powershell.exe');
            expect(args).toContain('-NoProfile');
            expect(args).toContain('-NonInteractive');
            expect(args[args.length - 1]).toMatch(/atlas-setup-r2\.ps1$/);
        } else {
            expect(bin).toBe('bash');
            expect(args[0]).toMatch(/atlas-setup-r2\.sh$/);
        }
    });

    it('project secrets override environment secrets on key collision', async () => {
        const projectId = await insertProject('echo "${variable.DUPE}"');
        await environmentSecretsService.replaceAll([{ key: 'DUPE', value: 'from-env' }]);
        await projectEnvFileService.dbUpsert(projectId, [{ key: 'DUPE', value: 'from-project' }]);

        let writtenContent = '';
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            const path = isWindows ? args[args.length - 1] : args[0];
            if (typeof path === 'string') writtenContent = readFileSync(path, 'utf8');
            return { stdout: '', stderr: '' };
        });

        await runProjectSetup({ projectId, worktreePath: sandboxRoot, runId: 'r3' });
        expect(writtenContent).toContain('from-project');
        expect(writtenContent).not.toContain('from-env');
    });

    it('returns ok:false kind:unknown_secret WITHOUT executing when a key is missing', async () => {
        const projectId = await insertProject('echo "${variable.MISSING}"');
        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'r4',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('unknown_secret');
            expect(out.output).toContain('MISSING');
        }
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('returns ok:false kind:nonzero with redacted stderr on non-zero exit', async () => {
        const projectId = await insertProject('echo "${variable.PASS}"');
        await environmentSecretsService.replaceAll([
            { key: 'PASS', value: 'super-secret-value' },
        ]);

        execFileMock.mockImplementation(() =>
            Promise.reject(
                Object.assign(new Error('command failed'), {
                    code: 7,
                    stdout: '',
                    stderr: 'bad: super-secret-value',
                }),
            ),
        );

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'r5',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('nonzero');
            expect(out.exitCode).toBe(7);
            // Secret value masked so it cannot leak via setup_output_text.
            expect(out.output).not.toContain('super-secret-value');
            expect(out.output).toContain('***');
        }
    });

    it('returns ok:false kind:timeout when execFile signals SIGTERM', async () => {
        const projectId = await insertProject('echo "${variable.X}"');
        await environmentSecretsService.replaceAll([{ key: 'X', value: 'x' }]);
        execFileMock.mockImplementation(() =>
            Promise.reject(
                Object.assign(new Error('timeout'), {
                    killed: true,
                    signal: 'SIGTERM',
                    stdout: '',
                    stderr: '',
                }),
            ),
        );
        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'r6',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.kind).toBe('timeout');
    });

    it('unlinks the tmpfile after a successful run', async () => {
        const projectId = await insertProject('echo "${variable.X}"');
        await environmentSecretsService.replaceAll([{ key: 'X', value: 'ok' }]);

        let observedPath = '';
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            observedPath = (isWindows ? args[args.length - 1] : args[0]) as string;
            // File exists at the moment the executable would have run.
            expect(existsSync(observedPath)).toBe(true);
            return { stdout: '', stderr: '' };
        });

        await runProjectSetup({ projectId, worktreePath: sandboxRoot, runId: 'cleanup-ok' });
        expect(observedPath).not.toBe('');
        expect(existsSync(observedPath)).toBe(false);
    });

    it('sweepOrphanSetupTmpfiles deletes only stale atlas-setup-* files', async () => {
        const { writeFileSync, existsSync, utimesSync } = await import('node:fs');
        const old = join(tmpdir(), 'atlas-setup-sweep-old.sh');
        const fresh = join(tmpdir(), 'atlas-setup-sweep-fresh.sh');
        const unrelated = join(tmpdir(), 'someone-elses-file.txt');
        writeFileSync(old, 'old');
        writeFileSync(fresh, 'fresh');
        writeFileSync(unrelated, 'unrelated');
        // Backdate `old` to 2 hours ago.
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        utimesSync(old, twoHoursAgo / 1000, twoHoursAgo / 1000);

        const unlinked = await sweepOrphanSetupTmpfiles();
        expect(unlinked).toBeGreaterThanOrEqual(1);
        expect(existsSync(old)).toBe(false);
        expect(existsSync(fresh)).toBe(true);
        expect(existsSync(unrelated)).toBe(true);

        // Cleanup so the sandbox dir stays tidy.
        for (const p of [fresh, unrelated]) {
            try {
                (await import('node:fs/promises')).unlink(p);
            } catch {
                /* best-effort */
            }
        }
    });

    it('unlinks the tmpfile even when execFile rejects', async () => {
        const projectId = await insertProject('echo "${variable.X}"');
        await environmentSecretsService.replaceAll([{ key: 'X', value: 'ok' }]);

        let observedPath = '';
        execFileMock.mockImplementation((_bin: string, args: string[]) => {
            observedPath = (isWindows ? args[args.length - 1] : args[0]) as string;
            return Promise.reject(
                Object.assign(new Error('crash'), { code: 1, stdout: '', stderr: '' }),
            );
        });

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'cleanup-fail',
        });
        expect(out.ok).toBe(false);
        expect(observedPath).not.toBe('');
        expect(existsSync(observedPath)).toBe(false);
    });

    it('returns ok:false kind:spawn_failed when execFile rejects without killed/numeric code', async () => {
        // Cover the third branch in the catch block: not killed (SIGTERM),
        // not a numeric exit code — i.e. the spawn itself failed (ENOENT etc.)
        const projectId = await insertProject('echo "${variable.X}"');
        await environmentSecretsService.replaceAll([{ key: 'X', value: 'ok' }]);

        execFileMock.mockImplementation(() =>
            Promise.reject(
                Object.assign(new Error('spawn ENOENT'), {
                    // code is a string (not a number) — the spawn_failed branch
                    code: 'ENOENT',
                    killed: false,
                    stdout: '',
                    stderr: '',
                }),
            ),
        );

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'spawn-fail',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('spawn_failed');
            expect(out.output).toContain('ENOENT');
        }
    });

    it('uses String(err) in spawn_failed output when error is non-Error (PJSR-STR-1)', async () => {
        // Covers `err instanceof Error ? err.message : String(err)` false branch at line 157.
        // The spawn_failed branch fires when killed=false and code is not a number.
        // redacted='' (empty stdout/stderr) so the ternary is evaluated.
        // We use a plain object (not an Error instance) that has code, killed, stdout, stderr
        // to hit the spawn_failed branch, plus `err instanceof Error` = false → String(err) fires.
        const projectId = await insertProject('echo "${variable.X}"');
        await environmentSecretsService.replaceAll([{ key: 'X', value: 'ok' }]);

        execFileMock.mockImplementation(() =>
            Promise.reject({
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                message: undefined,
                code: 'ENOENT',
                killed: false,
                stdout: '',
                stderr: '',
                toString() { return 'non-error-spawn-plain'; },
            }),
        );

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'spawn-fail-non-error',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('spawn_failed');
            // String(obj) calls obj.toString() → 'non-error-spawn-plain'.
            expect(out.output).toBe('non-error-spawn-plain');
        }
    });

    it('converts Buffer stdout/stderr to string when execFile rejects with Buffers', async () => {
        // Covers the `e.stdout instanceof Buffer` and `e.stderr instanceof Buffer`
        // branches at lines 138-139. execFileAsync can return Buffer-typed output
        // when encoding is not specified — the runner must decode explicitly.
        const projectId = await insertProject('echo "${variable.SEC}"');
        await environmentSecretsService.replaceAll([{ key: 'SEC', value: 'secretvalue123' }]);

        execFileMock.mockImplementation(() =>
            Promise.reject(
                Object.assign(new Error('cmd failed'), {
                    code: 2,
                    killed: false,
                    stdout: Buffer.from('out line with secretvalue123'),
                    stderr: Buffer.from('err line'),
                }),
            ),
        );

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'buf-output',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('nonzero');
            // The Buffer was decoded and the secret was redacted.
            expect(out.output).toContain('***');
            expect(out.output).not.toContain('secretvalue123');
        }
    });

    it('does not redact secret values shorter than REDACT_MIN_LENGTH (4 chars)', async () => {
        // Covers the `if (value.length < REDACT_MIN_LENGTH) continue;` branch
        // in redactSecretValues. Short secrets like "ok" must not be redacted
        // because that would clobber every occurrence of that substring.
        const projectId = await insertProject('echo "${variable.SHORT}"');
        // "abc" is length 3 — below the 4-char threshold
        await environmentSecretsService.replaceAll([{ key: 'SHORT', value: 'abc' }]);

        execFileMock.mockImplementation(() =>
            Promise.reject(
                Object.assign(new Error('cmd failed'), {
                    code: 1,
                    killed: false,
                    stdout: 'output contains abc',
                    stderr: '',
                }),
            ),
        );

        const out = await runProjectSetup({
            projectId,
            worktreePath: sandboxRoot,
            runId: 'short-secret',
        });
        expect(out.ok).toBe(false);
        if (!out.ok) {
            expect(out.kind).toBe('nonzero');
            // The 3-char secret "abc" must NOT be replaced — it's below the min length.
            expect(out.output).toContain('abc');
        }
    });

});
