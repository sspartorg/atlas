import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeSecrets } from './secret-substitution.js';
import { environmentSecretsService } from './environment-secrets.js';
import { projectEnvFileService } from './project-env-file.js';
import { redactSecretValues } from './project-setup-runner.js';

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

export type GateResult =
    | { kind: 'pass' }
    | { kind: 'fail'; output: string }
    | { kind: 'unavailable'; reason: string };

/** The staged guardrail script that runs typecheck, lint and the test suite. */
const GATE_SCRIPT_ID = 'coder-tests-green';

export function gateScriptPath(repoPath: string): string {
    return process.platform === 'win32'
        ? join(repoPath, '.atlas', 'scripts', 'powershell', `check-${GATE_SCRIPT_ID}.ps1`)
        : join(repoPath, '.atlas', 'scripts', 'bash', `check-${GATE_SCRIPT_ID}.sh`);
}

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
    const scriptPath = gateScriptPath(opts.repoPath);
    try {
        await access(scriptPath);
    } catch {
        // The worktree was staged without guardrail scripts, or torn down
        // already. No evidence either way — do not call it a failure.
        return { kind: 'unavailable', reason: `no verification script at ${scriptPath}` };
    }

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
    const isWindows = process.platform === 'win32';
    const bin = isWindows ? 'powershell.exe' : 'bash';
    const args = isWindows
        ? ['-NoProfile', '-NonInteractive', '-File', scriptPath, opts.itemId, '--run-tests']
        : [scriptPath, opts.itemId, '--run-tests'];

    try {
        await execFileAsync(bin, args, {
            cwd: opts.repoPath,
            env: { ...process.env },
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
}
