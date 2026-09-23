import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mergeSecrets } from './secret-substitution.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';
import { redactSecretValues } from './project-setup-runner.js';
import { guardrailScriptsService } from './guardrailScripts.js';
import { projectGuardrailScriptsService } from './projectGuardrailScripts.js';

// ADR 0020 — Atlas runs the verification gate itself.
//
// Before ADR 0020 the only thing standing between a red test suite and a
// merged pull request was the agent's own word. `decideRunRouting` reads the
// `atlas-outcome` block and `if (item.passed)` believes it; nothing ever ran
// the guardrail scripts that `constitution-assembler.ts` stages into the
// worktree. Campaign finding F-012 recorded the consequence: one Task shipped
// two PRs with red suites while every reviewer agent reported green.
//
// This module is the other consumer of those staged scripts. The agent still
// gets them to run during its own work; now the engine runs the gate once more
// itself, immediately before a push, and believes the exit code instead.
//
// Design contracts:
//   - **Per repo, not per run.** ADR 0017 Tasks span several repos and each
//     carries its own suite, so the gate runs in the checkout about to be
//     pushed. A repo whose suite is red is not pushed; its siblings are
//     unaffected.
//   - **"Could not run" is never a failure.** A missing script, an absent
//     binary or a timeout is *absence of evidence*. Returning `unavailable`
//     parks the run with the Owner. Treating it as red would convert an
//     unenforced gate into one that blocks every delivery — a worse failure
//     than the one being fixed.
//   - Output is mask-redacted with the same secret set the setup runner uses,
//     because a failing test can print an environment variable and this output
//     is persisted to the run log.
//   - Nothing is written to the worktree. The gate only reads and executes.

const execFileAsync = promisify(execFile);

/** Matches the setup runner. A real suite is slower than a setup script. */
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min
const MAX_BUFFER = 8 * 1024 * 1024;
/** Enough of the tail to identify the failure without pasting a whole suite. */
const MAX_REPORTED_OUTPUT = 4000;

/**
 * The child's environment: an allowlist, not `{...process.env}`.
 *
 * G-021 — the gate's failure output is persisted to the run log and rendered
 * to the Owner, and `redactSecretValues` masks only `environment_secrets` and
 * the project env file. The parent process carries `DATABASE_URL` (with the
 * password), `POSTGRES_PASSWORD` and `ATLAS_MCP_TOKEN`, none of which are in
 * that mask set — so a test that dumps its environment on failure, which is
 * common, wrote a live DB password into a stored log with nobody doing
 * anything wrong.
 *
 * An allowlist is a smaller change than widening the mask and is a guarantee
 * rather than a best effort: a secret that never enters the child cannot be
 * printed by it. Project secrets still reach the script the way they always
 * have — inlined by the setup runner — not through here.
 */
function gateEnv(): NodeJS.ProcessEnv {
    const allow = ['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER', 'LOGNAME'];
    const env: NodeJS.ProcessEnv = {};
    for (const key of allow) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    // Node toolchains need these to resolve a runtime; they carry no secret.
    for (const [key, value] of Object.entries(process.env)) {
        if (/^(NODE_|npm_config_prefix$|VOLTA_|NVM_|ASDF_|PNPM_HOME$|COREPACK_)/.test(key) && value !== undefined) {
            env[key] = value;
        }
    }
    env['CI'] = '1';
    return env;
}

export type GateResult =
    | { kind: 'pass' }
    | { kind: 'fail'; output: string }
    | { kind: 'unavailable'; reason: string };

/** The guardrail script id whose body is the gate. Project row overrides the Atlas one. */
export const GATE_SCRIPT_ID = 'coder-tests-green';

function tail(text: string): string {
    return text.length <= MAX_REPORTED_OUTPUT ? text : text.slice(-MAX_REPORTED_OUTPUT);
}

/**
 * Run the project's own typecheck/lint/test gate in `repoPath` and report what
 * the exit code says. `--run-tests` is what makes the script run the declared
 * `test` script rather than stopping at typecheck and lint.
 */
export async function runVerificationGate(opts: {
    repoPath: string;
    projectId: string;
    /** Passed through as the script's first argument; unused by the script today. */
    itemId: string;
}): Promise<GateResult> {
    // G-022 — run the script Atlas HAS, never the one sitting in the repo.
    //
    // This used to `execFile` `<repo>/.atlas/scripts/bash/check-…​.sh` directly.
    // `constitution-assembler` normally writes that file during staging, but
    // the gate never verified it had: a repository that ships its own copy of
    // that path gets it executed with `cwd` = the repo, on a worktree that was
    // never staged or whose guardrail row was deleted. `access()` tested
    // existence, which a planted file also satisfies. Note the execute bit is
    // no defence either — `bash <path>` ignores it.
    //
    // The body now comes from `guardrail_scripts` (project override wins, the
    // same precedence `mergeScriptsById` uses) and is written to a 0600 tmpfile
    // outside the worktree, mirroring `project-setup-runner.ts`. A repo can no
    // longer choose what Atlas executes.
    const body = await gateScriptBody(opts.projectId);
    if (!body) {
        return {
            kind: 'unavailable',
            reason: `no '${GATE_SCRIPT_ID}' guardrail script is configured`,
        };
    }
    const isWin = process.platform === 'win32';
    const scriptPath = join(tmpdir(), `atlas-gate-${randomUUID()}.${isWin ? 'ps1' : 'sh'}`);
    await writeFile(scriptPath, body.endsWith('\n') ? body : body + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });

    // Same secret set the setup runner masks with. Failing to load them must
    // not block delivery, but it does mean we cannot mask — in that case the
    // output is dropped rather than risk persisting a plaintext secret.
    let secrets: ReadonlyMap<string, string> | null = null;
    try {
        secrets = mergeSecrets(
            await environmentSecretsService.decryptAll(),
            new Map((await projectEnvFileService.dbList(opts.projectId)).map((v) => [v.key, v.value])),
        );
    } catch {
        secrets = null;
    }

    const timeoutMs = Number(process.env['ATLAS_GATE_TIMEOUT_MS']) || DEFAULT_TIMEOUT_MS;
    const isWindows = isWin;
    const bin = isWindows ? 'powershell.exe' : 'bash';
    const args = isWindows
        ? ['-NoProfile', '-NonInteractive', '-File', scriptPath, opts.itemId, '--run-tests']
        : [scriptPath, opts.itemId, '--run-tests'];

    try {
      try {
        await execFileAsync(bin, args, {
            cwd: opts.repoPath,
            env: gateEnv(),
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER,
            windowsHide: true,
        });
        return { kind: 'pass' };
    } catch (err: unknown) {
        const e = err as {
            code?: number | string;
            signal?: NodeJS.Signals;
            killed?: boolean;
            stdout?: string | Buffer;
            stderr?: string | Buffer;
        };
        // A timeout or a signal kill is not a red suite — we never learned the
        // answer. Same for a spawn failure, which surfaces as a string code
        // (ENOENT, EACCES) rather than a numeric exit status.
        if (e.killed || e.signal) {
            return { kind: 'unavailable', reason: `verification gate timed out after ${timeoutMs}ms` };
        }
        if (typeof e.code !== 'number') {
            return { kind: 'unavailable', reason: `could not run the verification gate: ${String(e.code ?? 'unknown')}` };
        }
        const stdout = e.stdout instanceof Buffer ? e.stdout.toString('utf8') : (e.stdout ?? '');
        const stderr = e.stderr instanceof Buffer ? e.stderr.toString('utf8') : (e.stderr ?? '');
        const raw = `${stdout}${stderr}`.trim();
        const output = secrets
            ? redactSecretValues(raw, secrets)
            : '(output withheld — the secret set could not be loaded to mask it)';
        return { kind: 'fail', output: tail(output) };
      }
    } finally {
        // The body can contain nothing secret, but it is Atlas-authored code
        // in a shared tmpdir — remove it even when the run throws.
        await unlink(scriptPath).catch(() => undefined);
    }
}

/** The `coder-tests-green` body, project override first. */
async function gateScriptBody(projectId: string): Promise<string | null> {
    const pick = (r: { id: string; body_sh: string; body_ps1: string }) =>
        process.platform === 'win32' ? r.body_ps1 : r.body_sh;
    try {
        const project = await projectGuardrailScriptsService.list(projectId);
        const override = project.find((r) => r.id === GATE_SCRIPT_ID);
        if (override) return pick(override) || null;
        const atlas = await guardrailScriptsService.list();
        const row = atlas.find((r) => r.id === GATE_SCRIPT_ID);
        return row ? pick(row) || null : null;
    } catch {
        return null;
    }
}
