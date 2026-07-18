import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../db/kysely-client.js';
import { mergeSecrets, substitute, UnknownSecretError } from './secret-substitution.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';

// 2026-06-10 — Per-project setup script runner. Sits between worktree
// staging and `spawnCli` in the orchestrator. If the script exits
// non-zero, references an unknown secret, or times out, the run is
// finalized with `status='setup_failed'` and the CLI is never spawned.
//
// Design contracts:
//   - The substituted script body NEVER touches the worktree directory.
//     It's written to `os.tmpdir()` with mode 0o600 and `unlink`ed in a
//     `finally` block so a crash mid-execution doesn't leave decrypted
//     secrets in a git-tracked path.
//   - Secrets are NOT passed via `process.env` to the child. They are
//     inlined into the script body before exec. Two reasons:
//     (1) the placeholder syntax already lets the author choose which
//         keys land where, and (2) `env: { ...process.env }` keeps the
//         child process matching the rest of the orchestrator's spawn
//         pattern without leaking `GIT_CONFIG_GLOBAL` auth creds.
//   - Output (stdout+stderr) is mask-redacted before being stored:
//     every secret value (length >= 4) is replaced with `***` so an
//     accidental `echo $VAR` in the user's script doesn't surface a
//     plaintext secret on the run-detail page.
//   - OS match is strict: Windows runs `setup_ps1_body`, POSIX runs
//     `setup_sh_body`. Empty matching blob is a no-op (`ok: true`).
//     The other-OS blob is ignored — no Git-Bash fallback on Windows,
//     per Owner decision (the runner mirrors the underlying platform).

const execFileAsync = promisify(execFile);

export type SetupResult =
    | { ok: true }
    | {
          ok: false;
          kind: 'unknown_secret' | 'nonzero' | 'timeout' | 'spawn_failed';
          output: string;
          exitCode?: number;
      };

const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const MAX_BUFFER = 8 * 1024 * 1024;
const REDACT_MIN_LENGTH = 4;

// Replace every secret value (long enough to be a real token) with `***`.
// Short values aren't masked — masking `"1"` would replace every digit `1`
// across stdout and produce garbage with no real protection.
function redactSecretValues(text: string, secrets: ReadonlyMap<string, string>): string {
    let out = text;
    for (const value of secrets.values()) {
        if (value.length < REDACT_MIN_LENGTH) continue;
        out = out.split(value).join('***');
    }
    return out;
}

export async function runProjectSetup(opts: {
    projectId: string;
    worktreePath: string;
    runId: string;
}): Promise<SetupResult> {
    const project = await db
        .selectFrom('projects')
        .select(['id'])
        // setup_sh_body / setup_ps1_body are bracket-accessed below because
        // the Kysely DB type for `ProjectsTable` doesn't yet carry these
        // columns (migration 004 added them; type-extension is a separate
        // cleanup). Reading via `selectAll` and casting keeps the runner
        // working without poking the type today.
        .selectAll()
        .where('id', '=', opts.projectId)
        .executeTakeFirst();
    if (!project) {
        return { ok: false, kind: 'spawn_failed', output: 'project not found' };
    }

    const isWindows = process.platform === 'win32';
    const blob = (
        isWindows
            ? (project as Record<string, unknown>)['setup_ps1_body']
            : (project as Record<string, unknown>)['setup_sh_body']
    ) as string | null | undefined;

    if (!blob || blob.trim() === '') {
        return { ok: true };
    }

    const envSecrets = await environmentSecretsService.decryptAll();
    const projectVars = await projectEnvFileService.dbList(opts.projectId);
    const projectSecrets = new Map(projectVars.map((v) => [v.key, v.value]));
    const merged = mergeSecrets(envSecrets, projectSecrets);

    let body: string;
    try {
        body = substitute(blob, merged);
    } catch (err) {
        if (err instanceof UnknownSecretError) {
            return { ok: false, kind: 'unknown_secret', output: err.message };
        }
        throw err;
    }

    const ext = isWindows ? 'ps1' : 'sh';
    const tmpPath = join(tmpdir(), `atlas-setup-${opts.runId}.${ext}`);
    await writeFile(tmpPath, body, { encoding: 'utf8', mode: 0o600 });

    const timeoutMs = Number(process.env['ATLAS_SETUP_TIMEOUT_MS']) || DEFAULT_TIMEOUT_MS;
    const bin = isWindows ? 'powershell.exe' : 'bash';
    const args: string[] = isWindows
        ? ['-NoProfile', '-NonInteractive', '-File', tmpPath]
        : [tmpPath];

    try {
        try {
            await execFileAsync(bin, args, {
                cwd: opts.worktreePath,
                env: { ...process.env },
                timeout: timeoutMs,
                maxBuffer: MAX_BUFFER,
                windowsHide: true,
            });
            return { ok: true };
        } catch (err: unknown) {
            const e = err as {
                code?: number | string;
                signal?: NodeJS.Signals;
                stdout?: string | Buffer;
                stderr?: string | Buffer;
                killed?: boolean;
            };
            const stdout =
                e.stdout instanceof Buffer ? e.stdout.toString('utf8') : (e.stdout ?? '');
            const stderr =
                e.stderr instanceof Buffer ? e.stderr.toString('utf8') : (e.stderr ?? '');
            const rawOutput = `${stdout}\n${stderr}`.trim();
            const redacted = redactSecretValues(rawOutput, merged);

            if (e.killed && e.signal === 'SIGTERM') {
                return {
                    ok: false,
                    kind: 'timeout',
                    output: redacted || `Setup script exceeded ${timeoutMs}ms`,
                };
            }
            if (typeof e.code === 'number') {
                return { ok: false, kind: 'nonzero', output: redacted, exitCode: e.code };
            }
            return {
                ok: false,
                kind: 'spawn_failed',
                output: redacted || (err instanceof Error ? err.message : String(err)),
            };
        }
    } finally {
        await unlink(tmpPath).catch(() => undefined);
    }
}

// 2026-06-10 — Best-effort startup sweeper. The runner's `try/finally`
// covers exceptions but not SIGKILL / OOM / power loss — leaving
// `atlas-setup-*.{ps1,sh}` orphans in the OS tmpdir with decrypted
// secrets inlined. On boot, walk the tmpdir and unlink any matches
// older than 1 hour (well above any realistic legitimate run that
// might still be alive across a restart). Failures are swallowed so a
// permission glitch can't block API boot.
const SWEEP_PREFIX = 'atlas-setup-';
const SWEEP_AGE_MS = 60 * 60 * 1000;

export async function sweepOrphanSetupTmpfiles(now: number = Date.now()): Promise<number> {
    const dir = tmpdir();
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return 0;
    }
    let unlinked = 0;
    for (const name of entries) {
        if (!name.startsWith(SWEEP_PREFIX)) continue;
        if (!name.endsWith('.ps1') && !name.endsWith('.sh')) continue;
        const full = join(dir, name);
        try {
            const s = await stat(full);
            if (now - s.mtimeMs < SWEEP_AGE_MS) continue;
            await unlink(full);
            unlinked += 1;
        } catch {
            // Best-effort; keep walking.
        }
    }
    return unlinked;
}
